"""Outbound alerts for pipeline failures, drift and staleness (docs/09 plane B).

Alerting must never be able to break a pipeline. Every function here swallows
its own transport errors and returns a boolean, because a Telegram outage is not
a reason to lose a night's ingestion, and an exception raised from inside an
error handler buries the original error.

Unconfigured is a normal state, not an error: a local developer has no webhook
and should see the alert on stdout instead.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal

import httpx
import structlog

from pipelines.lib.config import Settings, get_settings

log = structlog.get_logger(__name__)

AlertSeverity = Literal["info", "warn", "high"]

_TELEGRAM_LIMIT = 4000


def send_alert(
    title: str,
    body: str = "",
    *,
    severity: AlertSeverity = "warn",
    context: Mapping[str, Any] | None = None,
    settings: Settings | None = None,
    client: httpx.Client | None = None,
) -> bool:
    """Send one alert. Returns True when at least one channel accepted it.

    Always logs, whether or not a channel is configured, so the structured log
    remains the complete record and the webhook is only a convenience.
    """
    resolved = settings or get_settings()
    payload_context = dict(context or {})

    log_fn = log.error if severity == "high" else log.warning
    log_fn("alert", title=title, severity=severity, body=body, **payload_context)

    if not resolved.alerts.configured:
        log.info("alert.unconfigured", title=title)
        return False

    delivered = False
    owns_client = client is None
    http = client or httpx.Client(timeout=10.0)
    try:
        if resolved.alerts.webhook_url:
            delivered |= _post_webhook(
                http, resolved.alerts.webhook_url, title, body, severity, payload_context
            )
        if resolved.alerts.telegram_bot_token and resolved.alerts.telegram_chat_id:
            delivered |= _post_telegram(
                http,
                resolved.alerts.telegram_bot_token,
                resolved.alerts.telegram_chat_id,
                title,
                body,
                severity,
            )
    finally:
        if owns_client:
            http.close()
    return delivered


def _post_webhook(
    client: httpx.Client,
    url: str,
    title: str,
    body: str,
    severity: AlertSeverity,
    context: Mapping[str, Any],
) -> bool:
    try:
        response = client.post(
            url,
            json={
                "title": title,
                "body": body,
                "severity": severity,
                "context": context,
                "service": "nidhi-pipelines",
            },
        )
        if response.status_code >= 300:
            log.warning("alert.webhook_rejected", status=response.status_code)
            return False
        return True
    except httpx.HTTPError as exc:
        log.warning("alert.webhook_failed", error=str(exc))
        return False


def _post_telegram(
    client: httpx.Client,
    token: str,
    chat_id: str,
    title: str,
    body: str,
    severity: AlertSeverity,
) -> bool:
    prefix = {"info": "INFO", "warn": "WARNING", "high": "CRITICAL"}[severity]
    text = f"[{prefix}] {title}"
    if body:
        text = f"{text}\n\n{body}"
    try:
        response = client.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": text[:_TELEGRAM_LIMIT],
                "disable_web_page_preview": True,
            },
        )
        if response.status_code >= 300:
            log.warning("alert.telegram_rejected", status=response.status_code)
            return False
        return True
    except httpx.HTTPError as exc:
        log.warning("alert.telegram_failed", error=str(exc))
        return False


def alert_pipeline_failure(
    source_id: str,
    error: BaseException,
    *,
    run_id: int | None = None,
    settings: Settings | None = None,
) -> bool:
    return send_alert(
        f"Pipeline failed: {source_id}",
        f"{type(error).__name__}: {error}",
        severity="high",
        context={"source_id": source_id, "run_id": run_id},
        settings=settings,
    )


def alert_drift(
    source_id: str,
    findings: list[Any],
    *,
    run_id: int | None = None,
    settings: Settings | None = None,
) -> bool:
    lines = [f"- [{getattr(f, 'severity', '?')}] {getattr(f, 'check', '?')}: "
             f"{getattr(f, 'detail', f)}" for f in findings]
    severity: AlertSeverity = (
        "high" if any(getattr(f, "severity", "") == "high" for f in findings) else "warn"
    )
    return send_alert(
        f"Drift detected: {source_id}",
        "\n".join(lines),
        severity=severity,
        context={"source_id": source_id, "run_id": run_id, "finding_count": len(findings)},
        settings=settings,
    )
