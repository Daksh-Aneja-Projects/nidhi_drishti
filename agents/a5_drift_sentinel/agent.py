"""A5 - drift sentinel (docs/05 A5).

Runs after every pipeline run. Compares the run's metrics against the recent
history of the same source, alerts on a finding, and on a severe finding pauses
that source's canonical writes while staging carries on.

The comparison itself is :func:`pipelines.lib.drift.sanity_check`, reused rather
than reimplemented. A second definition of "what counts as drift" would drift
from the first, which would be a fitting but expensive irony.

This agent makes no model call at all. The findings are statistical comparisons
against a baseline, and asking a language model whether a row count looks
plausible would add cost, latency and non-determinism to a question arithmetic
already answers. The model is available for the alert prose and is deliberately
not used: an alert that reads differently every time is harder to triage.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import structlog

from agents.a5_drift_sentinel.pause import (
    FilePauseStore,
    InMemoryPauseStore,
    PauseRecord,
    PauseStore,
    now,
)
from agents.lib.config import AgentSettings, get_agent_settings
from pipelines.lib.alerting import send_alert
from pipelines.lib.drift import DriftFinding, RunMetrics, sanity_check, should_abort, worst_severity

log = structlog.get_logger(__name__)

AGENT_ID = "A5"


@dataclass(frozen=True, slots=True)
class SentinelVerdict:
    """What the sentinel concluded about one run."""

    source_id: str
    run_id: int | None
    findings: tuple[DriftFinding, ...]
    severity: str | None
    paused: bool
    alerted: bool

    @property
    def canonical_writes_allowed(self) -> bool:
        return not self.paused

    def summary(self) -> str:
        if not self.findings:
            return f"{self.source_id}: run looks consistent with recent history."
        lines = [f"{self.source_id}: {len(self.findings)} drift finding(s)."]
        lines.extend(f"- [{f.severity}] {f.check}: {f.detail}" for f in self.findings)
        if self.paused:
            lines.append(
                "Canonical writes for this source are paused. Staging ingestion continues, so "
                "the artifacts are still being collected and can be reprocessed once the "
                "parser is fixed."
            )
        return "\n".join(lines)


class DriftSentinel:
    """docs/05 A5. Compare, alert, and pause canonical writes when it is bad."""

    def __init__(
        self,
        *,
        settings: AgentSettings | None = None,
        pause_store: PauseStore | None = None,
        alert: bool = True,
    ) -> None:
        self.settings = settings or get_agent_settings()
        self.pause_store = pause_store or FilePauseStore(
            self.settings.state_dir / "paused_sources.json"
        )
        self.alert = alert

    def check(
        self,
        source_id: str,
        current: RunMetrics,
        history: Sequence[RunMetrics],
        *,
        run_id: int | None = None,
        auto_pause: bool = True,
    ) -> SentinelVerdict:
        findings = tuple(sanity_check(current, history))
        severity = worst_severity(findings)
        should_pause = auto_pause and should_abort(findings)

        if should_pause:
            reason = "; ".join(f"{f.check}: {f.detail}" for f in findings if f.severity == "high")
            self.pause_store.pause(
                PauseRecord(source_id=source_id, reason=reason, paused_at=now(), run_id=run_id)
            )
            log.error("a5.source_paused", source_id=source_id, run_id=run_id, reason=reason[:500])

        alerted = False
        if self.alert and findings and severity in {"warn", "high"}:
            alerted = send_alert(
                f"Drift detected: {source_id}",
                "\n".join(f"- [{f.severity}] {f.check}: {f.detail}" for f in findings)
                + (
                    "\n\nCanonical writes for this source are now paused. Staging continues."
                    if should_pause
                    else ""
                ),
                severity="high" if severity == "high" else "warn",
                context={
                    "source_id": source_id,
                    "run_id": run_id,
                    "finding_count": len(findings),
                    "paused": should_pause,
                    "agent_id": AGENT_ID,
                },
                settings=self.settings.base,
            )

        verdict = SentinelVerdict(
            source_id=source_id,
            run_id=run_id,
            findings=findings,
            severity=severity,
            paused=should_pause or self.pause_store.is_paused(source_id),
            alerted=alerted,
        )
        log.info(
            "a5.checked",
            source_id=source_id,
            run_id=run_id,
            findings=len(findings),
            severity=severity,
            paused=verdict.paused,
        )
        return verdict

    # -- register --------------------------------------------------------

    def is_paused(self, source_id: str) -> bool:
        """The gate a pipeline consults before a canonical write."""
        return self.pause_store.is_paused(source_id)

    def resume(self, source_id: str, *, note: str = "") -> bool:
        """Lift a pause. Deliberately manual: a human confirms the fix."""
        lifted = self.pause_store.resume(source_id)
        if lifted:
            log.info("a5.source_resumed", source_id=source_id, note=note)
        return lifted

    def paused_sources(self) -> dict[str, PauseRecord]:
        return self.pause_store.paused()


def in_memory_sentinel(settings: AgentSettings | None = None) -> DriftSentinel:
    """A sentinel that touches no files and sends no alerts. For tests."""
    return DriftSentinel(settings=settings, pause_store=InMemoryPauseStore(), alert=False)
