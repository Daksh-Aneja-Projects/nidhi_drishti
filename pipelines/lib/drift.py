"""Structural drift detection, docs/02 section 5.

A government portal rarely announces that it moved a column. It just serves a
page that still parses, into numbers that are now wrong. Schema validation
catches the shape changing; this module catches the shape staying the same while
the meaning moves.

Four checks, all comparing this run against the recent history of the same
source: row count swing, total swing, column-set change, parse-error rate.

The output is advisory data, not an exception. The source module decides what a
finding means, but a ``high`` severity finding must abort the canonical write.
"""

from __future__ import annotations

import statistics
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field
from decimal import Decimal
from typing import Any, Literal

import structlog

log = structlog.get_logger(__name__)

Severity = Literal["info", "warn", "high"]

#: Row count or total moving by more than this fraction against the recent
#: median is a drift signal. docs/02 fixes it at 50 percent.
SWING_THRESHOLD = 0.5
#: A second, wider band. Beyond this the run is almost certainly parsing a
#: different document than it thinks.
SEVERE_SWING_THRESHOLD = 0.9
#: Share of rows that failed to parse. Above the warn level something changed;
#: above the high level the parser no longer understands the document.
PARSE_ERROR_WARN_RATE = 0.02
PARSE_ERROR_HIGH_RATE = 0.10


@dataclass(frozen=True, slots=True)
class RunMetrics:
    """The metrics one run produces, stored in ``pipeline_run.metrics``.

    ``columns`` is the set of column or field names the parser actually saw. It
    is the cheapest possible canary for a restructured table.
    """

    row_count: int
    total_amount_inr_cr: Decimal | None = None
    columns: tuple[str, ...] = ()
    parse_error_count: int = 0
    extra: dict[str, Any] = field(default_factory=dict)

    def to_jsonable(self) -> dict[str, Any]:
        data = asdict(self)
        data["columns"] = list(self.columns)
        data["total_amount_inr_cr"] = (
            str(self.total_amount_inr_cr) if self.total_amount_inr_cr is not None else None
        )
        return data

    @classmethod
    def from_jsonable(cls, data: dict[str, Any]) -> RunMetrics:
        total = data.get("total_amount_inr_cr")
        return cls(
            row_count=int(data.get("row_count", 0)),
            total_amount_inr_cr=Decimal(str(total)) if total is not None else None,
            columns=tuple(data.get("columns", ()) or ()),
            parse_error_count=int(data.get("parse_error_count", 0)),
            extra=dict(data.get("extra", {}) or {}),
        )


@dataclass(frozen=True, slots=True)
class DriftFinding:
    """One thing that looks wrong about this run."""

    check: str
    severity: Severity
    detail: str
    current: Any = None
    baseline: Any = None

    def to_jsonable(self) -> dict[str, Any]:
        return {
            "check": self.check,
            "severity": self.severity,
            "detail": self.detail,
            "current": _jsonable(self.current),
            "baseline": _jsonable(self.baseline),
        }


def _jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (set, frozenset, tuple)):
        return sorted(str(item) for item in value)
    return value


def _relative_swing(current: float, baseline: float) -> float | None:
    """Signed relative change against the baseline, or None when undefined."""
    if baseline == 0:
        return None
    return (current - baseline) / abs(baseline)


def sanity_check(
    current: RunMetrics,
    history: Sequence[RunMetrics],
    *,
    swing_threshold: float = SWING_THRESHOLD,
) -> list[DriftFinding]:
    """Compare this run against recent successful runs of the same source.

    ``history`` is most-recent-first and may be empty on a source's first run,
    in which case only the checks that need no baseline fire. A first run is not
    treated as suspicious: it is treated as having nothing to compare against,
    which is a different and honest statement.
    """
    findings: list[DriftFinding] = []

    # 1. Zero rows. Needs no history and is never acceptable: a source that
    #    legitimately has nothing new should not have been fetched, and a page
    #    that parses to nothing is a moved page.
    if current.row_count == 0:
        findings.append(
            DriftFinding(
                check="zero_rows",
                severity="high",
                detail=(
                    "The parser produced no rows. Either the document moved, or its structure "
                    "changed enough that no row was recognised."
                ),
                current=0,
            )
        )

    # 4. Parse-error rate. Also needs no history.
    attempted = current.row_count + current.parse_error_count
    if attempted > 0 and current.parse_error_count > 0:
        rate = current.parse_error_count / attempted
        if rate >= PARSE_ERROR_HIGH_RATE:
            severity: Severity = "high"
        elif rate >= PARSE_ERROR_WARN_RATE:
            severity = "warn"
        else:
            severity = "info"
        findings.append(
            DriftFinding(
                check="parse_error_rate",
                severity=severity,
                detail=(
                    f"{current.parse_error_count} of {attempted} rows could not be parsed "
                    f"({rate * 100:.1f} percent). Unparsed rows are queued, never guessed at."
                ),
                current=round(rate, 4),
                baseline=PARSE_ERROR_HIGH_RATE,
            )
        )

    if not history:
        if not findings:
            findings.append(
                DriftFinding(
                    check="no_baseline",
                    severity="info",
                    detail="First recorded run for this source, so no comparison was possible.",
                    current=current.row_count,
                )
            )
        return findings

    # 2. Row count swing against the median of recent runs. Median rather than
    #    the single previous run, so one bad run does not become the baseline
    #    that hides the next one.
    baseline_rows = statistics.median(item.row_count for item in history)
    swing = _relative_swing(current.row_count, baseline_rows)
    if swing is not None and abs(swing) > swing_threshold:
        findings.append(
            DriftFinding(
                check="row_count_swing",
                severity="high" if abs(swing) > SEVERE_SWING_THRESHOLD else "warn",
                detail=(
                    f"Row count moved {swing * 100:+.1f} percent against a recent median of "
                    f"{baseline_rows:g} rows."
                ),
                current=current.row_count,
                baseline=baseline_rows,
            )
        )

    # 3. Total amount swing. The number that ends up on the dashboard, so this
    #    is the check that matters most. A unit misread turns into a 100x swing
    #    and is caught here even when every row validated cleanly.
    historic_totals = [
        item.total_amount_inr_cr for item in history if item.total_amount_inr_cr is not None
    ]
    if current.total_amount_inr_cr is not None and historic_totals:
        baseline_total = statistics.median(historic_totals)
        total_swing = _relative_swing(float(current.total_amount_inr_cr), float(baseline_total))
        if total_swing is not None and abs(total_swing) > swing_threshold:
            findings.append(
                DriftFinding(
                    check="total_amount_swing",
                    severity="high" if abs(total_swing) > SEVERE_SWING_THRESHOLD else "warn",
                    detail=(
                        f"Total moved {total_swing * 100:+.1f} percent against a recent median of "
                        f"{baseline_total} crore. A swing near 100x usually means a unit was "
                        f"read as crore when the document said lakh, or the reverse."
                    ),
                    current=current.total_amount_inr_cr,
                    baseline=baseline_total,
                )
            )

    # 4. Column-set change. The clearest single signal that a table was
    #    restructured, and the one that catches a silently renamed column before
    #    it becomes a silently wrong number.
    previous_columns = next((item.columns for item in history if item.columns), ())
    if current.columns and previous_columns:
        added = set(current.columns) - set(previous_columns)
        removed = set(previous_columns) - set(current.columns)
        if added or removed:
            findings.append(
                DriftFinding(
                    check="column_set_change",
                    # Removal is severe: a column we relied on is gone. Addition
                    # alone is usually a new statistic being published.
                    severity="high" if removed else "warn",
                    detail=(
                        f"Column set changed. Added: {sorted(added) or 'none'}. "
                        f"Removed: {sorted(removed) or 'none'}."
                    ),
                    current=current.columns,
                    baseline=previous_columns,
                )
            )

    for finding in findings:
        log.warning("drift.finding", **finding.to_jsonable())
    return findings


def worst_severity(findings: Sequence[DriftFinding]) -> Severity | None:
    """Highest severity present, or None when the run is clean."""
    order: dict[Severity, int] = {"info": 0, "warn": 1, "high": 2}
    if not findings:
        return None
    return max((f.severity for f in findings), key=lambda s: order[s])


def should_abort(findings: Sequence[DriftFinding]) -> bool:
    """A high-severity finding stops the canonical write.

    Stale data with a loud alert is recoverable. Wrong data published under our
    own provenance affordance is not.
    """
    return any(finding.severity == "high" for finding in findings)
