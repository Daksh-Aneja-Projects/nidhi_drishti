"""Polite HTTP client for public government sources.

docs/08 section 1 is a compliance boundary, not a style guide, so the rules it
sets are enforced by this module rather than trusted to each source author:

* an honest User-Agent naming the project and a contact address;
* robots.txt consulted before the first request to a host and cached per host;
* a minimum gap between two requests to the same host, shared process-wide so
  that two client instances cannot halve it between them;
* no authenticated endpoints, no credential headers, no CAPTCHA flows. We read
  exactly what the site serves an anonymous visitor and nothing else.

The single choke point is :meth:`PoliteClient._request`. Every public method
goes through it. There is no escape hatch that skips the guards, because an
escape hatch is what gets used at 2am when a source has just broken.
"""

from __future__ import annotations

import threading
import time
import urllib.robotparser
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from types import TracebackType
from urllib.parse import urlparse

import httpx
import structlog
from tenacity import (
    RetryCallState,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)
from tenacity import Retrying as _Retrying

from pipelines.lib.config import Settings, get_settings

log = structlog.get_logger(__name__)

#: Headers a caller must never set. Sending any of these would mean we are no
#: longer reading what an anonymous visitor reads.
FORBIDDEN_REQUEST_HEADERS = frozenset({"authorization", "cookie", "proxy-authorization"})

#: URL fragments that mark an authentication or bot-challenge flow. Hitting one
#: is a bug in the source module, so it raises rather than being skipped.
BLOCKED_URL_FRAGMENTS = (
    "captcha",
    "j_security_check",
    "/login",
    "/signin",
    "/sign-in",
    "/logon",
    "/auth/",
    "sso",
)

#: Statuses worth another attempt. A 4xx means the resource is gone or we are
#: not welcome; retrying it is rude and pointless.
RETRYABLE_STATUSES = frozenset({429, 500, 502, 503, 504, 522, 524})


class FetchError(RuntimeError):
    """A request failed in a way the source module has to handle."""


class RobotsDisallowed(FetchError):
    """robots.txt forbids this path for our User-Agent.

    docs/08: when a Tier 1 source disallows crawling we use its data.gov.in
    mirror or a manual periodic download and record that decision in
    source_registry.access_note. We do not proceed anyway.
    """


class AccessControlled(FetchError):
    """The URL looks like a login, SSO or CAPTCHA flow. Never followed."""


class HttpStatusError(FetchError):
    """Non-2xx response that survived the retry policy."""

    def __init__(self, url: str, status_code: int, body_excerpt: str = "") -> None:
        super().__init__(f"{status_code} for {url}")
        self.url = url
        self.status_code = status_code
        self.body_excerpt = body_excerpt


@dataclass(frozen=True, slots=True)
class FetchResult:
    """One fetched artifact, before it is stored or parsed."""

    url: str
    final_url: str
    status_code: int
    content: bytes
    content_type: str
    fetched_at: datetime
    headers: Mapping[str, str] = field(default_factory=dict)

    @property
    def text(self) -> str:
        """Decoded body. Government pages are frequently mislabelled as latin-1
        while containing UTF-8, so decoding is tolerant rather than strict."""
        return self.content.decode("utf-8", errors="replace")

    @property
    def byte_size(self) -> int:
        return len(self.content)


class _HostThrottle:
    """Process-wide per-host rate limiter.

    Module-level state on purpose. If the throttle lived on the client, a source
    module that constructs two clients would double its request rate against the
    same government host without anyone noticing.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._last_request: dict[str, float] = {}

    def wait(self, host: str, min_delay: float, *, sleep: object = time.sleep) -> float:
        """Block until ``min_delay`` has passed since the last request to ``host``.

        Returns the number of seconds actually waited, which the caller records
        in run metrics so a source that is throttling us shows up on the ops
        page rather than just feeling slow.
        """
        sleeper = sleep if callable(sleep) else time.sleep
        with self._lock:
            now = time.monotonic()
            previous = self._last_request.get(host)
            delay = 0.0
            if previous is not None:
                elapsed = now - previous
                if elapsed < min_delay:
                    delay = min_delay - elapsed
            # The slot is claimed inside the lock so concurrent callers queue
            # instead of all measuring against the same stale timestamp.
            self._last_request[host] = now + delay
        if delay > 0:
            sleeper(delay)
        return delay

    def reset(self) -> None:
        """Test-only. Clears the timing table."""
        with self._lock:
            self._last_request.clear()


_THROTTLE = _HostThrottle()


def _log_retry(state: RetryCallState) -> None:
    log.warning(
        "fetch.retry",
        attempt=state.attempt_number,
        wait_seconds=getattr(state.next_action, "sleep", None),
        error=str(state.outcome.exception()) if state.outcome else None,
    )


class PoliteClient:
    """HTTP client that cannot be talked out of good manners.

    Usage::

        with PoliteClient(settings) as client:
            result = client.get("https://cga.nic.in/MonthlyReport.aspx")

    ``transport`` exists so tests can serve canned responses. It changes where
    bytes come from and nothing else: robots, throttling and the URL guard all
    still run, which is what keeps the tests honest about the real behaviour.
    """

    def __init__(
        self,
        settings: Settings | None = None,
        *,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 60.0,
        max_attempts: int = 4,
        sleep: object = time.sleep,
    ) -> None:
        self._settings = settings or get_settings()
        self._scraper = self._settings.scraper
        self._max_attempts = max_attempts
        self._sleep = sleep
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self._robots_lock = threading.Lock()
        self._client = httpx.Client(
            transport=transport,
            timeout=timeout,
            follow_redirects=True,
            headers={
                "User-Agent": self._scraper.user_agent,
                "Accept-Encoding": "gzip, deflate",
            },
        )
        self.requests_made = 0
        self.seconds_throttled = 0.0

    # -- lifecycle ---------------------------------------------------------

    def __enter__(self) -> PoliteClient:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    # -- guards ------------------------------------------------------------

    @staticmethod
    def _check_url(url: str) -> None:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            raise FetchError(f"Refusing non-HTTP URL {url!r}.")
        if not parsed.netloc:
            raise FetchError(f"Refusing URL without a host: {url!r}")
        if parsed.username or parsed.password:
            raise AccessControlled(f"Refusing URL carrying credentials: {parsed.netloc}")
        lowered = url.lower()
        for fragment in BLOCKED_URL_FRAGMENTS:
            if fragment in lowered:
                raise AccessControlled(
                    f"Refusing {url!r}: it looks like an authentication or CAPTCHA flow. "
                    f"docs/08 permits only what the site serves an anonymous visitor."
                )

    @staticmethod
    def _check_headers(headers: Mapping[str, str] | None) -> None:
        if not headers:
            return
        for name in headers:
            if name.lower() in FORBIDDEN_REQUEST_HEADERS:
                raise AccessControlled(
                    f"Refusing to send a {name} header. Only anonymous public access is allowed."
                )

    def _robots_for(self, url: str) -> urllib.robotparser.RobotFileParser | None:
        """Fetch and cache robots.txt for the URL's origin.

        A missing or unreadable robots.txt is treated as "no rules stated",
        which is the conventional reading. A robots.txt that we could fetch and
        that disallows us is obeyed.
        """
        parsed = urlparse(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        with self._robots_lock:
            if origin in self._robots:
                return self._robots[origin]

        parser: urllib.robotparser.RobotFileParser | None = None
        robots_url = f"{origin}/robots.txt"
        try:
            # Deliberately not routed through _request: that would recurse.
            # This single request is exempt from robots (you cannot ask
            # robots.txt for permission to read robots.txt) but not from the
            # host throttle.
            self.seconds_throttled += _THROTTLE.wait(
                parsed.netloc, self._scraper.min_delay_seconds, sleep=self._sleep
            )
            response = self._client.get(robots_url)
            self.requests_made += 1
            if response.status_code == 200:
                parser = urllib.robotparser.RobotFileParser()
                parser.parse(response.text.splitlines())
            else:
                log.info("robots.absent", origin=origin, status=response.status_code)
        except httpx.HTTPError as exc:
            log.info("robots.unreachable", origin=origin, error=str(exc))

        with self._robots_lock:
            self._robots[origin] = parser
        return parser

    def may_fetch(self, url: str) -> bool:
        """True when robots.txt permits this URL for our User-Agent."""
        if not self._scraper.respect_robots:
            # Only ever set false for a local fixture server. Logged loudly so
            # it cannot sit unnoticed in a production environment file.
            log.warning("robots.disabled", url=url)
            return True
        parser = self._robots_for(url)
        if parser is None:
            return True
        return parser.can_fetch(self._scraper.user_agent, url)

    # -- request path ------------------------------------------------------

    def _request(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, str] | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> FetchResult:
        self._check_url(url)
        self._check_headers(headers)

        if not self.may_fetch(url):
            raise RobotsDisallowed(
                f"robots.txt disallows {url!r} for our User-Agent. Use the data.gov.in mirror "
                f"or a manual periodic download, and record the decision in "
                f"source_registry.access_note."
            )

        host = urlparse(url).netloc

        def attempt() -> FetchResult:
            self.seconds_throttled += _THROTTLE.wait(
                host, self._scraper.min_delay_seconds, sleep=self._sleep
            )
            try:
                response = self._client.request(method, url, params=params, headers=headers)
            except httpx.HTTPError as exc:
                raise FetchError(f"{method} {url} failed: {exc}") from exc
            self.requests_made += 1

            if response.status_code in RETRYABLE_STATUSES:
                raise HttpStatusError(url, response.status_code, response.text[:200])
            if response.status_code >= 400:
                # Not retried. A 404 on a government portal usually means the
                # page moved, which is a drift signal for the source module.
                raise HttpStatusError(url, response.status_code, response.text[:200])

            # Redirects are followed, so the URL that was vetted before the
            # request is not necessarily the URL that answered. This is not
            # hypothetical: PFMS answers 200 on a plausible report path and
            # redirects it to Login.aspx (docs/13). A login page fetched via a
            # clean-looking entry URL is still a login page, so the final URL
            # passes through the same gate as the first.
            self._check_url(str(response.url))

            return FetchResult(
                url=url,
                final_url=str(response.url),
                status_code=response.status_code,
                content=response.content,
                content_type=response.headers.get("content-type", "").split(";")[0].strip()
                or "application/octet-stream",
                fetched_at=datetime.now(UTC),
                headers=dict(response.headers),
            )

        retrying = _Retrying(
            stop=stop_after_attempt(self._max_attempts),
            wait=wait_exponential(multiplier=2, min=2, max=60),
            retry=retry_if_exception_type((FetchError,)) & _retry_only_transient(),
            before_sleep=_log_retry,
            reraise=True,
            sleep=self._sleep if callable(self._sleep) else time.sleep,
        )
        result: FetchResult = retrying(attempt)
        log.info(
            "fetch.ok",
            url=url,
            status=result.status_code,
            bytes=result.byte_size,
            content_type=result.content_type,
        )
        return result

    def get(
        self,
        url: str,
        *,
        params: Mapping[str, str] | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> FetchResult:
        return self._request("GET", url, params=params, headers=headers)

    def head(self, url: str, *, headers: Mapping[str, str] | None = None) -> FetchResult:
        return self._request("HEAD", url, headers=headers)


def _retry_only_transient() -> retry_if_exception_type:
    """Retry predicate that excludes permanent failures.

    Written as a small class rather than a lambda so tenacity can combine it
    with ``&`` and so the intent survives a future refactor: a 404 is
    information about the source having moved, and hammering it four times
    delays the drift alert without improving the outcome.
    """

    class _Predicate(retry_if_exception_type):
        def __init__(self) -> None:
            super().__init__(FetchError)

        def __call__(self, retry_state: RetryCallState) -> bool:
            if retry_state.outcome is None or not retry_state.outcome.failed:
                return False
            exc = retry_state.outcome.exception()
            if isinstance(exc, RobotsDisallowed | AccessControlled):
                return False
            if isinstance(exc, HttpStatusError):
                return exc.status_code in RETRYABLE_STATUSES
            return isinstance(exc, FetchError)

    return _Predicate()


def reset_throttle_for_tests() -> None:
    """Clear the process-wide host timing table. Tests only."""
    _THROTTLE.reset()
