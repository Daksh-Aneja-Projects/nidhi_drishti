"""Shared fixtures.

Nothing here talks to the network, a database, or S3. Two hard rules for this
suite:

* a test that would make a live request is a bug in the test, so the polite
  client is only ever constructed over a canned transport;
* fixtures use realistic Indian government table strings, because the parsers'
  whole job is coping with what these documents actually look like.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest

from pipelines.lib.config import (
    AlertSettings,
    S3Settings,
    ScraperSettings,
    Settings,
)
from pipelines.lib.fetch import PoliteClient, reset_throttle_for_tests

FIXTURE_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def settings() -> Settings:
    """Settings that never point at anything real."""
    return Settings(
        database_url="postgres://test:test@localhost:1/none",
        s3=S3Settings(
            endpoint="http://localhost:1",
            region="us-east-1",
            bucket="test-bucket",
            access_key="test",
            secret_key="test",
            force_path_style=True,
        ),
        scraper=ScraperSettings(
            user_agent="NidhiDrishtiTest/1.0 (test suite; contact@example.org)",
            min_delay_seconds=2.0,
            respect_robots=True,
        ),
        alerts=AlertSettings(webhook_url="", telegram_bot_token="", telegram_chat_id=""),
        data_mode="demo",
        ogd_api_key="test-key",
        sentry_dsn="",
    )


@pytest.fixture(autouse=True)
def _clean_throttle() -> Iterator[None]:
    """The host throttle is process-wide, so it has to be reset between tests."""
    reset_throttle_for_tests()
    yield
    reset_throttle_for_tests()


class RecordingSleeper:
    """Stands in for time.sleep so tests never actually wait."""

    def __init__(self) -> None:
        self.calls: list[float] = []

    def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)

    @property
    def total(self) -> float:
        return sum(self.calls)


@pytest.fixture
def sleeper() -> RecordingSleeper:
    return RecordingSleeper()


def make_client(
    settings: Settings,
    handler: Any,
    sleeper: Any,
    *,
    max_attempts: int = 3,
) -> PoliteClient:
    """A PoliteClient over a canned transport, with sleeping stubbed out.

    The guards (robots, throttle, URL check) all still run. That is deliberate:
    a test double that skips them would prove nothing about the real behaviour.
    """
    return PoliteClient(
        settings,
        transport=httpx.MockTransport(handler),
        sleep=sleeper,
        max_attempts=max_attempts,
    )


@pytest.fixture
def fixture_text() -> Any:
    def _read(name: str) -> str:
        return (FIXTURE_DIR / name).read_text(encoding="utf-8")

    return _read


class FakeObjectStore:
    """In-memory stand-in for S3, with the same call signatures boto3 uses."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.puts = 0
        self.heads = 0

    def head_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:
        self.heads += 1
        if Key not in self.objects:
            raise _NoSuchKey()
        return {"ContentLength": len(self.objects[Key])}

    def put_object(self, *, Bucket: str, Key: str, Body: bytes, **_: Any) -> dict[str, Any]:
        self.puts += 1
        self.objects[Key] = Body
        return {"ETag": "test"}

    def get_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:
        import io

        return {"Body": io.BytesIO(self.objects[Key])}


class _NoSuchKey(Exception):
    """Mimics the botocore exception name that storage._exists checks for."""

    def __init__(self) -> None:
        super().__init__("Not Found")
        self.response = {"Error": {"Code": "404"}}


@pytest.fixture
def object_store() -> FakeObjectStore:
    return FakeObjectStore()
