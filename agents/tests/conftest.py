"""Test doubles for the agent layer.

Everything here exists so the suite runs with no network, no API key and no
Postgres. The doubles are deliberately thin: the fake connection still routes
through :class:`agents.lib.db.GuardedConnection`, so every test that writes is
also exercising the write guard, and the fake transport returns the same shapes
the SDK returns so the response-flattening code is genuinely under test.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

import pytest

from agents.lib.client import AgentClient, MemoryCallLogger
from agents.lib.config import AgentSettings
from agents.lib.db import GuardedConnection
from agents.lib.prompts import Prompt
from pipelines.lib.config import (
    AlertSettings,
    S3Settings,
    ScraperSettings,
    Settings,
)

# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


@pytest.fixture
def base_settings(tmp_path) -> Settings:
    return Settings(
        database_url="postgres://nidhi:nidhi@localhost:5433/nidhi_test",
        s3=S3Settings(
            endpoint="http://localhost:9002",
            region="us-east-1",
            bucket="nidhi-raw",
            access_key="k",
            secret_key="s",
            force_path_style=True,
        ),
        scraper=ScraperSettings(
            user_agent="NidhiDrishti/1.0 (test suite; contact@example.org)",
            min_delay_seconds=2.0,
            respect_robots=True,
        ),
        alerts=AlertSettings(webhook_url="", telegram_bot_token="", telegram_chat_id=""),
        data_mode="demo",
        ogd_api_key="",
        sentry_dsn="",
        repo_root=tmp_path,
    )


@pytest.fixture
def agent_settings(base_settings, tmp_path) -> AgentSettings:
    return AgentSettings(
        anthropic_api_key="",
        model_fast="claude-haiku-4-5",
        model_standard="claude-sonnet-5",
        model_narrative="claude-opus-4-8",
        enable_web_search=False,
        web_search_allowlist=("pib.gov.in",),
        max_output_tokens=4000,
        state_dir=tmp_path / "state",
        base=base_settings,
    )


# ---------------------------------------------------------------------------
# Transport
# ---------------------------------------------------------------------------


@dataclass
class FakeUsage:
    input_tokens: int = 1200
    output_tokens: int = 300


@dataclass
class FakeBlock:
    type: str
    text: str = ""
    content: Any = None


@dataclass
class FakeResponse:
    """Shaped like an SDK ``Message``, only with the fields the wrapper reads."""

    content: list[FakeBlock]
    model: str = "claude-sonnet-5"
    stop_reason: str = "end_turn"
    usage: FakeUsage = field(default_factory=FakeUsage)


def text_response(payload: Any, *, model: str = "claude-sonnet-5") -> FakeResponse:
    """A response whose single text block is JSON, as structured output returns."""
    body = payload if isinstance(payload, str) else json.dumps(payload)
    return FakeResponse(content=[FakeBlock(type="text", text=body)], model=model)


class FakeTransport:
    """Returns queued responses in order, recording every request it received."""

    def __init__(self, responses: Sequence[Any] | None = None) -> None:
        self.responses: list[Any] = list(responses or [])
        self.requests: list[dict[str, Any]] = []

    def queue(self, *responses: Any) -> FakeTransport:
        self.responses.extend(responses)
        return self

    def create(self, **kwargs: Any) -> Any:
        self.requests.append(kwargs)
        if not self.responses:
            raise AssertionError(
                "FakeTransport ran out of queued responses. The code under test made more "
                "model calls than the test expected."
            )
        nxt = self.responses.pop(0)
        if isinstance(nxt, BaseException):
            raise nxt
        if callable(nxt):
            return nxt(**kwargs)
        return nxt


@pytest.fixture
def transport() -> FakeTransport:
    return FakeTransport()


@pytest.fixture
def call_logger() -> MemoryCallLogger:
    return MemoryCallLogger()


@pytest.fixture
def client(agent_settings, transport, call_logger) -> AgentClient:
    return AgentClient(settings=agent_settings, transport=transport, call_logger=call_logger)


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

Router = Callable[[str, Any], list[dict[str, Any]]]


class FakeCursor:
    """Routes a statement to canned rows by matching a substring of the SQL."""

    def __init__(self, owner: FakeRawConnection) -> None:
        self._owner = owner
        self._rows: list[dict[str, Any]] = []

    def execute(self, query: Any, params: Any = None, **_: Any) -> FakeCursor:
        sql = str(query)
        self._owner.executed.append((sql, params))
        self._rows = self._owner.rows_for(sql, params)
        return self

    def executemany(self, query: Any, params_seq: Any, **_: Any) -> None:
        for params in params_seq:
            self.execute(query, params)

    def fetchone(self) -> dict[str, Any] | None:
        return self._rows[0] if self._rows else None

    def fetchall(self) -> list[dict[str, Any]]:
        return list(self._rows)

    def fetchmany(self, size: int | None = None) -> list[dict[str, Any]]:
        return list(self._rows[:size] if size else self._rows)

    def __iter__(self):
        return iter(self._rows)

    def __enter__(self) -> FakeCursor:
        return self

    def __exit__(self, *_: Any) -> None:
        return None

    @property
    def rowcount(self) -> int:
        return len(self._rows)


class FakeRawConnection:
    """A psycopg-shaped connection backed by a table of SQL-fragment routes."""

    def __init__(self, routes: dict[str, list[dict[str, Any]] | Router] | None = None) -> None:
        self.routes: dict[str, list[dict[str, Any]] | Router] = dict(routes or {})
        self.executed: list[tuple[str, Any]] = []
        self.committed = False
        self.rolled_back = False

    def route(self, fragment: str, rows: list[dict[str, Any]] | Router) -> FakeRawConnection:
        self.routes[fragment] = rows
        return self

    def rows_for(self, sql: str, params: Any) -> list[dict[str, Any]]:
        collapsed = re.sub(r"\s+", " ", sql)
        for fragment, rows in self.routes.items():
            if re.sub(r"\s+", " ", fragment) in collapsed:
                return list(rows(sql, params)) if callable(rows) else list(rows)
        # An unrouted RETURNING statement still has to yield an id, or every
        # insert helper would assert. 1 is as good as any.
        if "returning" in collapsed.lower():
            key = collapsed.lower().split("returning", 1)[1].strip().split()[0]
            return [{key: 1}]
        return []

    def cursor(self, *_: Any, **__: Any) -> FakeCursor:
        return FakeCursor(self)

    def execute(self, query: Any, params: Any = None, **kwargs: Any) -> FakeCursor:
        return FakeCursor(self).execute(query, params, **kwargs)

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        self.rolled_back = True

    def close(self) -> None:
        return None

    # -- assertions helpers -------------------------------------------------

    def statements_touching(self, table: str) -> list[str]:
        return [sql for sql, _ in self.executed if table in sql.lower()]

    def params_for(self, fragment: str) -> list[Any]:
        collapsed = re.sub(r"\s+", " ", fragment)
        return [params for sql, params in self.executed if collapsed in re.sub(r"\s+", " ", sql)]


@pytest.fixture
def raw_conn() -> FakeRawConnection:
    return FakeRawConnection()


@pytest.fixture
def conn(raw_conn) -> GuardedConnection:
    return GuardedConnection(raw_conn)


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------


def make_prompt(name: str = "fixture_prompt", text: str | None = None) -> Prompt:
    """A Prompt object without touching the filesystem."""
    import hashlib

    body = text or (
        "Fixture prompt. State no evidence found rather than infer. "
        "Never use the words scam, fraud, siphoned or corrupt."
    )
    return Prompt(
        name=name,
        text=body,
        sha256=hashlib.sha256(body.encode("utf-8")).hexdigest(),
        path=__import__("pathlib").Path(f"/fixtures/{name}.md"),
    )


@pytest.fixture
def prompt() -> Prompt:
    return make_prompt()


def only(items: Iterable[Any]) -> Any:
    values = list(items)
    assert len(values) == 1, f"expected exactly one item, got {len(values)}"
    return values[0]
