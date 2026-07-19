"""Politeness and access-posture tests, docs/08 section 1.

These are compliance tests, not performance tests. They assert that the client
cannot be talked out of the rules: no client instance, no argument, and no
convenience method skips robots, the delay, or the credential guard.
"""

from __future__ import annotations

import httpx
import pytest

from pipelines.lib.config import MIN_ALLOWED_DELAY_SECONDS, ConfigError, Settings, load_settings
from pipelines.lib.fetch import (
    AccessControlled,
    FetchError,
    HttpStatusError,
    RobotsDisallowed,
)
from pipelines.tests.conftest import RecordingSleeper, make_client

ROBOTS_ALLOW_ALL = "User-agent: *\nAllow: /\n"
ROBOTS_DISALLOW_ALL = "User-agent: *\nDisallow: /\n"


def handler_for(
    body: bytes = b"<html><body>ok</body></html>",
    *,
    robots: str = ROBOTS_ALLOW_ALL,
    status: int = 200,
    content_type: str = "text/html",
    calls: list[str] | None = None,
):
    def handle(request: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append(str(request.url))
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text=robots)
        return httpx.Response(status, content=body, headers={"content-type": content_type})

    return handle


class TestUserAgent:
    def test_the_honest_user_agent_is_sent(self, settings: Settings) -> None:
        seen: dict[str, str] = {}

        def handle(request: httpx.Request) -> httpx.Response:
            seen[request.url.path] = request.headers.get("user-agent", "")
            if request.url.path == "/robots.txt":
                return httpx.Response(200, text=ROBOTS_ALLOW_ALL)
            return httpx.Response(200, text="ok")

        with make_client(settings, handle, RecordingSleeper()) as client:
            client.get("https://cga.nic.in/report")

        assert "NidhiDrishtiTest" in seen["/report"]
        assert "contact@example.org" in seen["/report"]

    def test_a_user_agent_without_a_contact_is_refused(self) -> None:
        from pipelines.lib.config import ScraperSettings

        with pytest.raises(ConfigError):
            ScraperSettings(user_agent="Mozilla/5.0", min_delay_seconds=2.0, respect_robots=True)


class TestRobots:
    def test_robots_is_fetched_before_the_first_request(self, settings: Settings) -> None:
        calls: list[str] = []
        with make_client(settings, handler_for(calls=calls), RecordingSleeper()) as client:
            client.get("https://cga.nic.in/report")
        assert calls[0].endswith("/robots.txt")

    def test_a_disallowed_path_raises(self, settings: Settings) -> None:
        with (
            make_client(
                settings, handler_for(robots=ROBOTS_DISALLOW_ALL), RecordingSleeper()
            ) as client,
            pytest.raises(RobotsDisallowed),
        ):
            client.get("https://cga.nic.in/report")

    def test_robots_is_cached_per_origin(self, settings: Settings) -> None:
        calls: list[str] = []
        with make_client(settings, handler_for(calls=calls), RecordingSleeper()) as client:
            client.get("https://cga.nic.in/one")
            client.get("https://cga.nic.in/two")
        assert sum(1 for call in calls if call.endswith("/robots.txt")) == 1

    def test_a_missing_robots_is_read_as_no_rules_stated(self, settings: Settings) -> None:
        def handle(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/robots.txt":
                return httpx.Response(404)
            return httpx.Response(200, text="ok")

        with make_client(settings, handle, RecordingSleeper()) as client:
            assert client.get("https://cga.nic.in/report").status_code == 200

    def test_a_disallowed_path_is_not_retried(self, settings: Settings) -> None:
        """Retrying a refusal is rude and pointless."""
        calls: list[str] = []
        with (
            make_client(
                settings,
                handler_for(robots=ROBOTS_DISALLOW_ALL, calls=calls),
                RecordingSleeper(),
            ) as client,
            pytest.raises(RobotsDisallowed),
        ):
            client.get("https://cga.nic.in/report")
        assert sum(1 for call in calls if not call.endswith("robots.txt")) == 0


class TestRateLimiting:
    def test_the_second_request_to_a_host_waits(self, settings: Settings) -> None:
        sleeper = RecordingSleeper()
        with make_client(settings, handler_for(), sleeper) as client:
            client.get("https://cga.nic.in/one")
            client.get("https://cga.nic.in/two")
        assert sleeper.total >= MIN_ALLOWED_DELAY_SECONDS

    def test_the_throttle_is_shared_across_client_instances(self, settings: Settings) -> None:
        """Two clients must not be able to halve the delay between them."""
        first_sleeper = RecordingSleeper()
        second_sleeper = RecordingSleeper()
        with make_client(settings, handler_for(), first_sleeper) as first:
            first.get("https://cga.nic.in/one")
        with make_client(settings, handler_for(), second_sleeper) as second:
            second.get("https://cga.nic.in/two")
        assert second_sleeper.total > 0

    def test_a_configured_delay_below_the_floor_is_raised_to_it(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("SCRAPER_MIN_DELAY_SECONDS", "0.01")
        monkeypatch.setenv(
            "SCRAPER_USER_AGENT", "NidhiDrishti/1.0 (transparency project; contact@example.org)"
        )
        loaded = load_settings(env_file="does-not-exist")
        assert loaded.scraper.min_delay_seconds == MIN_ALLOWED_DELAY_SECONDS

    def test_a_stricter_delay_is_honoured(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("SCRAPER_MIN_DELAY_SECONDS", "10")
        monkeypatch.setenv(
            "SCRAPER_USER_AGENT", "NidhiDrishti/1.0 (transparency project; contact@example.org)"
        )
        assert load_settings(env_file="does-not-exist").scraper.min_delay_seconds == 10.0


class TestAccessControlGuards:
    @pytest.mark.parametrize(
        "url",
        [
            "https://eprocure.gov.in/eprocure/login",
            "https://eprocure.gov.in/captcha/image",
            "https://pfms.nic.in/j_security_check",
            "https://sansad.in/auth/token",
            "https://gem.gov.in/signin",
        ],
    )
    def test_authentication_and_captcha_urls_are_refused(
        self, settings: Settings, url: str
    ) -> None:
        with make_client(settings, handler_for(), RecordingSleeper()) as client:
            with pytest.raises(AccessControlled):
                client.get(url)

    def test_credential_headers_are_refused(self, settings: Settings) -> None:
        with make_client(settings, handler_for(), RecordingSleeper()) as client:
            with pytest.raises(AccessControlled):
                client.get("https://cga.nic.in/report", headers={"Authorization": "Bearer x"})
            with pytest.raises(AccessControlled):
                client.get("https://cga.nic.in/report", headers={"Cookie": "session=1"})

    def test_urls_carrying_credentials_are_refused(self, settings: Settings) -> None:
        with make_client(settings, handler_for(), RecordingSleeper()) as client:
            with pytest.raises(AccessControlled):
                client.get("https://user:pass@cga.nic.in/report")

    def test_non_http_schemes_are_refused(self, settings: Settings) -> None:
        with make_client(settings, handler_for(), RecordingSleeper()) as client:
            with pytest.raises(FetchError):
                client.get("file:///etc/passwd")


class TestRetries:
    def test_a_server_error_is_retried(self, settings: Settings) -> None:
        attempts = {"count": 0}

        def handle(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/robots.txt":
                return httpx.Response(200, text=ROBOTS_ALLOW_ALL)
            attempts["count"] += 1
            if attempts["count"] < 3:
                return httpx.Response(503, text="try later")
            return httpx.Response(200, text="ok")

        with make_client(settings, handle, RecordingSleeper()) as client:
            assert client.get("https://cga.nic.in/report").status_code == 200
        assert attempts["count"] == 3

    def test_a_404_is_not_retried_because_it_is_a_drift_signal(self, settings: Settings) -> None:
        attempts = {"count": 0}

        def handle(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/robots.txt":
                return httpx.Response(200, text=ROBOTS_ALLOW_ALL)
            attempts["count"] += 1
            return httpx.Response(404, text="gone")

        with make_client(settings, handle, RecordingSleeper()) as client:
            with pytest.raises(HttpStatusError) as caught:
                client.get("https://cga.nic.in/moved")
        assert attempts["count"] == 1
        assert caught.value.status_code == 404

    def test_retries_give_up_and_reraise(self, settings: Settings) -> None:
        with (
            make_client(
                settings, handler_for(status=503), RecordingSleeper(), max_attempts=2
            ) as client,
            pytest.raises(HttpStatusError),
        ):
            client.get("https://cga.nic.in/report")


class TestFetchResult:
    def test_result_carries_provenance_fields(self, settings: Settings) -> None:
        with make_client(settings, handler_for(b"<html>x</html>"), RecordingSleeper()) as client:
            result = client.get("https://cga.nic.in/report")
        assert result.content_type == "text/html"
        assert result.byte_size == len(b"<html>x</html>")
        assert result.fetched_at.tzinfo is not None
        assert "html" in result.text
