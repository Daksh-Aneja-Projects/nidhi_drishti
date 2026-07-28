"""Environment-driven settings for the ingestion layer.

Everything here mirrors ``.env.example`` at the repo root. A frozen dataclass is
used rather than a settings framework so that the scraping-posture fields
(user agent, delay, robots) cannot be mutated at runtime by a caller who is in a
hurry: docs/08 section 1 makes them a compliance control, not a tuning knob.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

# Repo root is three levels up from this file: pipelines/lib/config.py.
REPO_ROOT = Path(__file__).resolve().parents[2]

#: Source ids declared across db/seed/02_source_registry.sql and
#: db/seed/06_scheme_portal_sources.sql. A pipeline may only write for an id in
#: this set; source_record.source_id is a foreign key to the registry, so
#: anything else fails at the database anyway, but failing here gives a readable
#: error before a single request is made. This set is the Python-side mirror of
#: the seed files and must be kept in step with them.
KNOWN_SOURCE_IDS: frozenset[str] = frozenset(
    {
        "union_budget",
        "cga_monthly",
        "pfms_pub",
        "ogd",
        "obi",
        "rbi",
        "cppp",
        "gem",
        "pib",
        "sansad_qa",
        "news",
        "demo",
        # Scheme-specific portals (docs/03 section 2.6, roadmap v1.1). Seeded in
        # db/seed/06_scheme_portal_sources.sql.
        "mgnrega",
        "pmkisan",
        "jjm",
        # v2 state-budget sources (docs/12). Seeded in db/seed/07_states.sql with
        # jurisdiction = 'state', which the CSS double-count guard keys off.
        "state_karnataka",
        "state_odisha",
    }
)

#: The floor for the politeness delay. docs/08 fixes the ceiling at one request
#: every two seconds against a government domain; a smaller configured value is
#: raised to this rather than honoured.
MIN_ALLOWED_DELAY_SECONDS = 2.0


class ConfigError(RuntimeError):
    """Raised when a mandatory setting is missing or obviously wrong."""


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _env_bool(name: str, default: bool) -> bool:
    raw = _env(name)
    if raw == "":
        return default
    return raw.lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    raw = _env(name)
    if raw == "":
        return default
    try:
        return float(raw)
    except ValueError as exc:  # pragma: no cover - configuration typo
        raise ConfigError(f"{name} must be a number, got {raw!r}") from exc


@dataclass(frozen=True, slots=True)
class ScraperSettings:
    """Politeness posture. See docs/08 section 1.

    We are guests on public infrastructure, so every request says who we are and
    how to reach a human. That requirement has not changed. Where it is said
    has, and the reason is worth recording.

    The contact used to be required *inside* the User-Agent. That turns out to
    be the single reason indiabudget.gov.in returned 403 to this project for
    months: its filter rejects any User-Agent containing an email address or a
    URL, and it does so regardless of who is asking. Measured against the live
    site, ``NidhiDrishti/1.0`` is served and
    ``NidhiDrishti/1.0 (contact@example.org)`` is refused, on the same file, one
    second apart.

    So the contact moved to ``From``, which RFC 9110 section 10.1.2 defines for
    exactly this: the email address of a human who controls the requesting
    agent. This is not a way around the filter. We still identify as a named
    non-browser client, we still obey robots, we still throttle, and we are now
    *more* reachable, because the address is in the header a server operator's
    tooling actually looks for rather than buried in a string. A publisher who
    wants us to stop has the same one address they always had.

    Both fields stay mandatory. Anonymity is the thing that is not allowed.
    """

    user_agent: str
    min_delay_seconds: float
    respect_robots: bool
    #: Email address or URL for a human who controls this crawler. Sent as the
    #: ``From`` request header on every request.
    contact: str = ""

    def __post_init__(self) -> None:
        if not self.user_agent or self.user_agent == "http":
            raise ConfigError("SCRAPER_USER_AGENT is mandatory and must name this project.")
        if not self.contact.strip():
            raise ConfigError(
                "SCRAPER_CONTACT is mandatory: an email address or URL for a human who can be "
                "asked to stop this crawler. It is sent as the From header on every request."
            )
        if "@" not in self.contact and "://" not in self.contact:
            raise ConfigError(
                "SCRAPER_CONTACT must be an email address or a URL, for example "
                "'contact@example.org'."
            )
        # A UA carrying a URL or an email is refused outright by at least one
        # Government of India portal. Caught here rather than as a mystery 403
        # six months into a deployment.
        if "://" in self.user_agent or "@" in self.user_agent:
            raise ConfigError(
                "SCRAPER_USER_AGENT must not contain a URL or an email address: some government "
                "portals refuse those outright. Put the contact in SCRAPER_CONTACT, which is sent "
                "as the From header."
            )


@dataclass(frozen=True, slots=True)
class S3Settings:
    endpoint: str
    region: str
    bucket: str
    access_key: str
    secret_key: str
    force_path_style: bool


@dataclass(frozen=True, slots=True)
class AlertSettings:
    webhook_url: str
    telegram_bot_token: str
    telegram_chat_id: str

    @property
    def configured(self) -> bool:
        return bool(self.webhook_url) or bool(self.telegram_bot_token and self.telegram_chat_id)


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str
    s3: S3Settings
    scraper: ScraperSettings
    alerts: AlertSettings
    data_mode: str
    ogd_api_key: str
    sentry_dsn: str
    repo_root: Path = field(default=REPO_ROOT)

    @property
    def is_live_mode(self) -> bool:
        """True when only pipeline-ingested data may be served."""
        return self.data_mode == "live"


def load_settings(*, env_file: str | os.PathLike[str] | None = None) -> Settings:
    """Build settings from the process environment, loading a .env file first.

    Values already present in the environment win over the file, which is what
    lets CI and container runtimes override without editing anything on disk.
    """
    candidate = Path(env_file) if env_file is not None else REPO_ROOT / ".env"
    if candidate.exists():
        load_dotenv(candidate, override=False)

    configured_delay = _env_float("SCRAPER_MIN_DELAY_SECONDS", MIN_ALLOWED_DELAY_SECONDS)
    # Deliberately one-directional: a stricter value is honoured, a laxer one is
    # not. Nobody gets to shave the delay down by editing an env var.
    effective_delay = max(configured_delay, MIN_ALLOWED_DELAY_SECONDS)

    return Settings(
        database_url=_env("DATABASE_URL", "postgres://nidhi:nidhi@localhost:5433/nidhi"),
        s3=S3Settings(
            endpoint=_env("S3_ENDPOINT", "http://localhost:9002"),
            region=_env("S3_REGION", "us-east-1"),
            bucket=_env("S3_BUCKET", "nidhi-raw"),
            access_key=_env("S3_ACCESS_KEY"),
            secret_key=_env("S3_SECRET_KEY"),
            force_path_style=_env_bool("S3_FORCE_PATH_STYLE", True),
        ),
        scraper=ScraperSettings(
            user_agent=_env(
                "SCRAPER_USER_AGENT",
                "NidhiDrishti/1.0 (public budget transparency project)",
            ),
            min_delay_seconds=effective_delay,
            respect_robots=_env_bool("SCRAPER_RESPECT_ROBOTS", True),
            contact=_env("SCRAPER_CONTACT", "contact@example.org"),
        ),
        alerts=AlertSettings(
            webhook_url=_env("ALERT_WEBHOOK_URL"),
            telegram_bot_token=_env("TELEGRAM_BOT_TOKEN"),
            telegram_chat_id=_env("TELEGRAM_CHAT_ID"),
        ),
        data_mode=_env("DATA_MODE", "demo").lower(),
        ogd_api_key=_env("OGD_API_KEY"),
        sentry_dsn=_env("SENTRY_DSN"),
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Process-wide settings, loaded once.

    Tests that need a different posture build a :class:`Settings` directly
    instead of mutating this cache.
    """
    return load_settings()


def require_known_source(source_id: str) -> str:
    """Guard: refuse to run for a source that is not in the registry seed."""
    if source_id not in KNOWN_SOURCE_IDS:
        raise ConfigError(
            f"Unknown source_id {source_id!r}. Declare it in db/seed/02_source_registry.sql "
            f"with a licence note before any pipeline writes for it (docs/03)."
        )
    return source_id
