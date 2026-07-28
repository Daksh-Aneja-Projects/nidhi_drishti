"""Sentry scrubbing and gating tests, docs/09 plane B.

The redaction here is what stands between a caught database error and a
connection string sitting in a third-party dashboard, so it is asserted
directly rather than trusted. `init_observability` is tested for its gating
behaviour only: no assertion here ever calls the real `sentry_sdk.init`,
because that would need a network-reachable DSN.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import replace

import pytest

from pipelines.lib import observability
from pipelines.lib.config import AlertSettings, S3Settings, ScraperSettings, Settings


@pytest.fixture(autouse=True)
def _reset_state() -> Iterator[None]:
    observability._reset_for_tests()
    yield
    observability._reset_for_tests()


def make_settings(*, sentry_dsn: str = "") -> Settings:
    return Settings(
        database_url="postgres://nidhi:nidhi@localhost:5433/nidhi",
        s3=S3Settings(
            endpoint="http://localhost:9002",
            region="us-east-1",
            bucket="nidhi-raw",
            access_key="nidhiminio",
            secret_key="nidhiminio123",
            force_path_style=True,
        ),
        scraper=ScraperSettings(
            user_agent="NidhiDrishti/1.0 (test)",
            min_delay_seconds=2.0,
            contact="tests@example.org",
            respect_robots=True,
        ),
        alerts=AlertSettings(webhook_url="", telegram_bot_token="", telegram_chat_id=""),
        data_mode="demo",
        ogd_api_key="",
        sentry_dsn=sentry_dsn,
    )


class TestRedactSecrets:
    def test_replaces_a_secret_found_in_a_plain_string(self) -> None:
        out = observability.redact_secrets(
            "error: could not reach postgres://u:p@host/db",
            ["postgres://u:p@host/db"],
        )
        assert out == "error: could not reach [redacted]"

    def test_redacts_every_occurrence(self) -> None:
        assert observability.redact_secrets("secret secret", ["secret"]) == "[redacted] [redacted]"

    def test_walks_nested_dicts_lists_and_tuples(self) -> None:
        event = {
            "message": "DATABASE_URL=postgres://u:p@host/db failed",
            "extra": {"breadcrumbs": ["connecting to postgres://u:p@host/db"]},
            "list": [{"deep": "postgres://u:p@host/db"}],
            "tup": ("postgres://u:p@host/db",),
        }
        out = observability.redact_secrets(event, ["postgres://u:p@host/db"])
        assert out["message"] == "DATABASE_URL=[redacted] failed"
        assert out["extra"]["breadcrumbs"][0] == "connecting to [redacted]"
        assert out["list"][0]["deep"] == "[redacted]"
        assert out["tup"] == ("[redacted]",)

    def test_leaves_unrelated_values_untouched(self) -> None:
        event = {"message": "ministry not found", "count": 3, "ok": True, "nothing": None}
        assert observability.redact_secrets(event, ["some-secret"]) == event

    def test_is_a_noop_with_no_secrets(self) -> None:
        event = {"message": "anything at all"}
        assert observability.redact_secrets(event, []) == event


class TestCollectSecretValues:
    def test_reads_declared_keys_and_skips_short_placeholders(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("DATABASE_URL", "postgres://nidhi:nidhi@localhost:5433/nidhi")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-abcdef123456")
        monkeypatch.setenv("OGD_API_KEY", "should-not-be-collected")
        monkeypatch.delenv("REDIS_URL", raising=False)
        monkeypatch.delenv("S3_ACCESS_KEY", raising=False)
        monkeypatch.delenv("S3_SECRET_KEY", raising=False)
        monkeypatch.delenv("ADMIN_REVIEW_TOKEN", raising=False)

        values = observability.collect_secret_values()
        assert "postgres://nidhi:nidhi@localhost:5433/nidhi" in values
        assert "sk-ant-abcdef123456" in values
        assert "should-not-be-collected" not in values

    def test_empty_when_nothing_set(self, monkeypatch: pytest.MonkeyPatch) -> None:
        for key in (
            "DATABASE_URL",
            "REDIS_URL",
            "S3_ACCESS_KEY",
            "S3_SECRET_KEY",
            "ANTHROPIC_API_KEY",
            "ADMIN_REVIEW_TOKEN",
        ):
            monkeypatch.delenv(key, raising=False)
        assert observability.collect_secret_values() == []


class TestInitObservability:
    def test_noop_without_a_dsn(self) -> None:
        armed = observability.init_observability("pipeline", settings=make_settings(sentry_dsn=""))
        assert armed is False

    def test_second_call_is_a_noop_even_with_different_settings(self) -> None:
        first = observability.init_observability("pipeline", settings=make_settings(sentry_dsn=""))
        second = observability.init_observability(
            "pipeline", settings=make_settings(sentry_dsn="https://key@example.test/1")
        )
        # Once the process has decided (here: "no DSN, stay off"), it does not
        # re-check on a later call; a mid-process env change should not
        # silently start a new integration with a different DSN than the one
        # the rest of the process believes is in effect.
        assert first is False
        assert second is False

    def test_settings_sentry_dsn_round_trips(self) -> None:
        settings = make_settings(sentry_dsn="https://key@example.test/1")
        assert settings.sentry_dsn == "https://key@example.test/1"
        # replace() proves the field is a normal dataclass attribute, not a
        # derived property that would hide a typo in the constructor call above.
        assert replace(settings, sentry_dsn="").sentry_dsn == ""
