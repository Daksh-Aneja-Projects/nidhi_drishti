"""Sentry initialisation shared by the pipeline runner and the agent runner
(docs/09 plane B).

Mirrors ``apps/web/src/lib/observability.ts`` in intent, not in code: the two
runtimes cannot share a module, so the scrubbing rule is re-implemented here
against the same list of secret env vars, and its own tests are run against
this copy rather than assumed to hold by symmetry with the TypeScript side.

No-op when ``SENTRY_DSN`` is unset, which keeps a local pipeline run and the
test suite silent and network-free even though ``sentry_sdk`` is an ordinary
dependency (not an optional extra): the package is always importable, but
``sentry_sdk.init`` is only ever called once a DSN is configured.
"""

from __future__ import annotations

import os
from collections.abc import Mapping, Sequence
from typing import Any, Literal

import sentry_sdk
import structlog
from sentry_sdk.types import Event, Hint

from pipelines.lib.config import Settings, get_settings

log = structlog.get_logger(__name__)

Component = Literal["pipeline", "agent"]

#: The Python-side twin of SECRET_ENV_KEYS in apps/web/src/lib/observability.ts.
#: Keep the two lists in sync; docs/09 names this exact set.
_SECRET_ENV_KEYS: tuple[str, ...] = (
    "DATABASE_URL",
    "REDIS_URL",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "ANTHROPIC_API_KEY",
    "ADMIN_REVIEW_TOKEN",
)

_REDACTED = "[redacted]"

#: Process-wide: sentry_sdk.init() is not meant to be called twice, and a
#: pipeline run may build several PipelineRun / AgentClient instances in one
#: process. Tests reset this through `_reset_for_tests`.
_initialized = False
#: True only once `sentry_sdk.init` has actually been called. `_initialized`
#: alone is not enough to gate `set_run_context` / `capture_exception`: it also
#: becomes true when a DSN is absent, which is the normal, silent, no-op case.
_armed = False


def collect_secret_values() -> list[str]:
    """Current values of the secret env vars, read fresh on every call.

    A value under 6 characters is skipped: a short placeholder such as the
    default ``change-me-locally`` admin token would otherwise match ordinary
    substrings inside unrelated event text and redact things that are not secrets.
    """
    values: list[str] = []
    for key in _SECRET_ENV_KEYS:
        value = os.environ.get(key, "")
        if len(value) >= 6:
            values.append(value)
    return values


def redact_secrets(value: Any, secrets: Sequence[str]) -> Any:
    """Recursively replace any occurrence of a secret value inside `value`."""
    if not secrets:
        return value
    if isinstance(value, str):
        out = value
        for secret in secrets:
            if secret in out:
                out = out.replace(secret, _REDACTED)
        return out
    if isinstance(value, list):
        return [redact_secrets(item, secrets) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_secrets(item, secrets) for item in value)
    if isinstance(value, Mapping):
        return {key: redact_secrets(item, secrets) for key, item in value.items()}
    return value


def _scrub_event(event: Event, _hint: Hint) -> Event | None:
    """``before_send`` / ``before_send_transaction`` for every Sentry call.

    Sentry serialises exception messages, breadcrumbs, and log records
    verbatim; any of those can carry a secret pulled from the environment by
    application code even though nothing here intentionally logs one. This is
    the last line of defence before an event leaves the process.
    """
    secrets = collect_secret_values()
    if not secrets:
        return event
    scrubbed: Event = redact_secrets(event, secrets)
    return scrubbed


def _sample_rate(env_key: str, fallback: float) -> float:
    raw = os.environ.get(env_key, "").strip()
    if not raw:
        return fallback
    try:
        parsed = float(raw)
    except ValueError:
        return fallback
    if parsed < 0.0 or parsed > 1.0:
        return fallback
    return parsed


def init_observability(
    component: Component,
    *,
    settings: Settings | None = None,
    release: str | None = None,
) -> bool:
    """Arm Sentry once per process. Returns True when it was armed.

    Called from ``pipelines/__main__.py`` (the pipeline runner) and from
    ``agents.lib.client.AgentClient.__init__`` (the agent runner). A second
    call in the same process -- a script that builds more than one
    ``AgentClient`` -- is a harmless no-op rather than a re-init, since
    ``sentry_sdk.init`` is not meant to be invoked twice.

    ``send_default_pii`` is explicitly false (CLAUDE.md, docs/08 section 4):
    no request bodies, no local variables in stack frames, no user context.
    """
    global _initialized, _armed
    if _initialized:
        return _armed

    resolved = settings or get_settings()
    dsn = resolved.sentry_dsn
    if not dsn:
        _initialized = True  # Nothing to arm; do not re-check on every call.
        log.debug("observability.disabled", component=component)
        return False

    sentry_sdk.init(
        dsn=dsn,
        environment=os.environ.get("NIDHI_ENV", "development"),
        release=release,
        traces_sample_rate=_sample_rate("SENTRY_TRACES_SAMPLE_RATE", 0.05),
        send_default_pii=False,
        include_local_variables=False,
        before_send=_scrub_event,
        before_send_transaction=_scrub_event,
    )
    sentry_sdk.set_tag("component", component)
    _initialized = True
    _armed = True
    log.info("observability.enabled", component=component)
    return True


def set_run_context(
    *,
    source_id: str | None = None,
    agent_id: str | None = None,
    run_id: int | None = None,
    entity_id: str | None = None,
) -> None:
    """Tag subsequent events with source_id / agent_id (docs/09 plane B: "tag
    events with source_id / agent_id where available"). A no-op whenever
    Sentry was never armed: `set_tag` before `init` is not an error, but it
    also is not visible anywhere, so it is skipped rather than left silent
    for the reader to wonder whether it did anything.
    """
    if not _armed:
        return
    if source_id:
        sentry_sdk.set_tag("source_id", source_id)
    if agent_id:
        sentry_sdk.set_tag("agent_id", agent_id)
    if run_id is not None:
        sentry_sdk.set_tag("run_id", run_id)
    if entity_id:
        sentry_sdk.set_tag("entity_id", entity_id)


def capture_exception(error: BaseException) -> None:
    """Explicit capture for an exception the caller handles rather than lets
    propagate to the interpreter's uncaught-exception hook (which Sentry also
    installs, so a genuinely uncaught error is reported either way). Used
    where code already has an `except` block for other reasons, such as the
    agent client's per-call telemetry, and would otherwise lose the trace.

    A no-op whenever Sentry was never armed, same reasoning as `set_run_context`.
    """
    if not _armed:
        return
    sentry_sdk.capture_exception(error)


def _reset_for_tests() -> None:
    """Test-only: clear the armed flag so a test can call init_observability
    again under different settings. Never called from application code.
    """
    global _initialized, _armed
    _initialized = False
    _armed = False
