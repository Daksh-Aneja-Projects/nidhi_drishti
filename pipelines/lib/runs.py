"""Pipeline run bookkeeping.

``pipeline_run`` is the source of truth for the ops page (docs/09 plane B), so
every run has to leave a row behind: the successful ones, the drifted ones, and
especially the ones that crashed. A run that dies without a row is a source that
silently stops updating, and silent staleness is the failure this whole project
is meant to be honest about.

    with PipelineRun("cga_monthly", conn) as run:
        run.metric(row_count=412)
        ...
        run.add_drift(findings)

Exit status:
  * an exception escaping the block   -> ``failed``, alert raised, re-raised
  * any drift finding recorded        -> ``drift_alert``, alert raised
  * otherwise                         -> ``ok``
"""

from __future__ import annotations

import time
import traceback
from collections.abc import Sequence
from decimal import Decimal
from types import TracebackType
from typing import Any

import psycopg
import structlog

from pipelines.lib import alerting
from pipelines.lib.config import Settings, require_known_source
from pipelines.lib.db import finish_pipeline_run, recent_run_metrics, start_pipeline_run
from pipelines.lib.drift import DriftFinding, RunMetrics, actionable, should_abort

log = structlog.get_logger(__name__)


class PipelineAborted(RuntimeError):
    """Raised when drift is severe enough that the canonical write must not happen."""


class PipelineRun:
    """Context manager writing one ``pipeline_run`` row.

    ``conn`` may be None for a dry run. Everything still happens except the two
    database writes, which is what makes ``--dry-run`` useful while adapting a
    parser to a source that has just been reorganised.
    """

    def __init__(
        self,
        source_id: str,
        conn: psycopg.Connection[dict[str, Any]] | None = None,
        *,
        settings: Settings | None = None,
        dry_run: bool = False,
    ) -> None:
        self.source_id = require_known_source(source_id)
        self.conn = conn
        self.settings = settings
        self.dry_run = dry_run or conn is None
        self.run_id: int | None = None
        self.metrics: dict[str, Any] = {}
        self.findings: list[DriftFinding] = []
        self.status: str = "running"
        self._started = 0.0

    # -- lifecycle ---------------------------------------------------------

    def __enter__(self) -> PipelineRun:
        self._started = time.monotonic()
        if self.conn is not None and not self.dry_run:
            self.run_id = start_pipeline_run(self.conn, self.source_id)
        log.info(
            "run.started", source_id=self.source_id, run_id=self.run_id, dry_run=self.dry_run
        )
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> bool:
        self.metrics["duration_seconds"] = round(time.monotonic() - self._started, 3)
        self.metrics["dry_run"] = self.dry_run

        if exc is not None:
            # A deliberate abort is a drift outcome, not a crash: the pipeline
            # worked exactly as designed and refused to write. Recording it as
            # 'failed' would hide the distinction between "we protected the data"
            # and "the code broke".
            deliberate = isinstance(exc, PipelineAborted)
            self.status = "drift_alert" if deliberate else "failed"
            self.metrics["error"] = f"{type(exc).__name__}: {exc}"
            self._finish(error_text="".join(traceback.format_exception_only(type(exc), exc)))
            if deliberate:
                alerting.alert_drift(
                    self.source_id, self.findings, run_id=self.run_id, settings=self.settings
                )
            else:
                alerting.alert_pipeline_failure(
                    self.source_id, exc, run_id=self.run_id, settings=self.settings
                )
            log.error(
                "run.aborted" if deliberate else "run.failed",
                source_id=self.source_id,
                run_id=self.run_id,
                error=str(exc),
            )
            # Never swallowed. The caller and the process exit code both need
            # to know, and the scheduler decides whether to retry.
            return False

        # Only warn and high findings make a run a drift alert. Informational
        # ones are kept in the metrics for the ops page and nowhere else.
        notable = actionable(self.findings)
        if notable:
            self.status = "drift_alert"
            alerting.alert_drift(
                self.source_id, notable, run_id=self.run_id, settings=self.settings
            )
        else:
            self.status = "ok"

        self._finish()
        log.info(
            "run.finished",
            source_id=self.source_id,
            run_id=self.run_id,
            status=self.status,
            **{k: v for k, v in self.metrics.items() if isinstance(v, (int, float, str, bool))},
        )
        return False

    def _finish(self, *, error_text: str | None = None) -> None:
        if self.conn is None or self.run_id is None:
            return
        finish_pipeline_run(
            self.conn,
            self.run_id,
            status=self.status,
            metrics=self.metrics,
            error_text=error_text,
        )

    # -- recording ---------------------------------------------------------

    def metric(self, **values: Any) -> None:
        """Record metrics. Decimals are stringified so JSONB keeps full precision."""
        for key, value in values.items():
            self.metrics[key] = str(value) if isinstance(value, Decimal) else value

    def set_run_metrics(self, metrics: RunMetrics) -> None:
        """Record the standard drift metrics block."""
        self.metrics.update(metrics.to_jsonable())

    def baseline(self, *, limit: int = 8) -> list[RunMetrics]:
        """Recent successful runs for this source, for :func:`drift.sanity_check`."""
        if self.conn is None:
            return []
        return recent_run_metrics(self.conn, self.source_id, limit=limit)

    def add_drift(self, findings: Sequence[DriftFinding]) -> None:
        """Attach drift findings. Any finding downgrades the run to drift_alert."""
        if not findings:
            return
        self.findings.extend(findings)
        self.metrics["drift"] = [finding.to_jsonable() for finding in self.findings]

    def abort_if_drifted(self, findings: Sequence[DriftFinding]) -> None:
        """Record findings and stop before the canonical write if any is severe.

        Called between sanity_check and upsert in every source module. Stale
        data with a loud alert is recoverable; wrong data published under our
        own provenance affordance is not.
        """
        self.add_drift(findings)
        if should_abort(findings):
            reasons = "; ".join(f"{f.check}: {f.detail}" for f in findings if f.severity == "high")
            raise PipelineAborted(
                f"Aborting {self.source_id} before the canonical write. {reasons}"
            )
