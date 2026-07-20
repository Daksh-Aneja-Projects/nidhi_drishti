"""Jal Jeevan Mission coverage and funding dashboard (jaljeevanmission.gov.in).

The mission publishes a public dashboard of household tap-water coverage and of
the funds behind it. Two kinds of figure live there, and they are kept in
different places:

* **Funding** figures are money and map to fiscal stages. **Central Release** is
  money leaving the Union, so it is the RELEASE stage; **Total Expenditure** is
  what the implementing agencies spent, so it is the UTILIZATION stage. It is
  deliberately *not* EXPENDITURE, which this system reserves for CGA accounted
  actuals (CLAUDE.md principle 2, docs/04 section 1).
* **Coverage** figures (household tap connections provided) are a *physical*
  count, not money. They are kept in run metrics only and never written to a
  fiscal-fact amount column, because a count of taps is not a number of rupees.

The dashboard is scheme-scoped, so every figure maps to the one fixed
:data:`SCHEME_ID`, which already exists in db/seed/04_schemes.sql. Figures are
cumulative for the financial year: stored with ``is_cumulative = true`` and never
summed across snapshots. The unit is read from the document; a page whose unit
cannot be found produces parse errors, not a guess (docs/04 section 5).
"""

from __future__ import annotations

import re
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, Literal

import psycopg
import structlog
from pydantic import BaseModel, ConfigDict, Field

from pipelines.lib.drift import RunMetrics, sanity_check
from pipelines.lib.fetch import PoliteClient
from pipelines.lib.ingest import ingest_url
from pipelines.lib.models import FiscalFactRow
from pipelines.lib.runs import PipelineRun
from pipelines.lib.validation import validate_rows
from pipelines.parsers.fy_dates import fy_end, fy_from_indian_label, fy_of
from pipelines.parsers.inr_amounts import (
    AmountParseError,
    Unit,
    parse_amount_cr,
    parse_unit_hint,
)
from pipelines.parsers.text_norm import clean_cell
from pipelines.sources._common import RunOutcome, soup_of, table_rows

log = structlog.get_logger(__name__)

SOURCE_ID = "jjm"

#: The scheme every figure from this portal belongs to. It already exists in
#: db/seed/04_schemes.sql; this module never invents a scheme id.
SCHEME_ID = "sch-jal-jeevan-mission"

#: Every entry point for this source, in one place. Not verified live. A 404
#: surfaces as a failed run with an alert; a served-but-restructured page parses
#: to zero rows which the drift check turns into a high-severity finding.
URLS: dict[str, str] = {
    "home": "https://jaljeevanmission.gov.in/",
    "dashboard": "https://jaljeevanmission.gov.in/jjmreport/JJMIndia.aspx",
}

#: Header words that identify the funding table.
FUND_TABLE_HEADERS = ("fund", "amount")

Stage = Literal["RELEASE", "UTILIZATION"]

#: Fund-head labels mapped to the fiscal stage they represent. Specific enough
#: that "central release" does not catch a "State Share Release" line and
#: "total expenditure" does not catch a "Percentage Expenditure" line.
STAGE_LABELS: dict[Stage, tuple[str, ...]] = {
    "RELEASE": ("central release", "central fund released", "central share released"),
    "UTILIZATION": ("total expenditure", "expenditure incurred", "total exp."),
}

#: Coverage labels. These are physical counts and are kept in run metrics only.
COVERAGE_LABELS: tuple[str, ...] = (
    "tap connections",
    "tap water connections",
    "household connections",
    "har ghar jal",
    "functional household",
)

#: Labels that look money-ish but are ratios or balances, not a fiscal stage.
_NON_STAGE_MARKERS = ("percentage", "percent", "% of", "balance", "available")

_INDIAN_FY = re.compile(r"\b(\d{4}\s*[-/]\s*\d{2,4})\b")
_COUNT_DIGITS = re.compile(r"[\d,]{2,}")


class JjmFundingRow(BaseModel):
    """One funding figure, tagged with the fiscal stage it belongs to."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    stage: Stage
    label_raw: str = Field(min_length=2)
    fy: str = Field(pattern=r"^FY\d{4}$")
    amount_inr_cr: Decimal
    as_of: date
    is_cumulative: bool = True


def _fy_from_text(text: str) -> str | None:
    match = _INDIAN_FY.search(text)
    if not match:
        return None
    try:
        return fy_from_indian_label(match.group(1))
    except Exception:  # noqa: BLE001 - not every 4-digit pair is a fiscal year
        return None


def classify_stage(label: str) -> Stage | None:
    """Map a fund-head label to a fiscal stage, or None when it is neither."""
    lowered = label.lower()
    if any(marker in lowered for marker in _NON_STAGE_MARKERS):
        return None
    for stage, aliases in STAGE_LABELS.items():
        if any(alias in lowered for alias in aliases):
            return stage
    return None


def _is_coverage_label(label: str) -> bool:
    lowered = label.lower()
    return any(alias in lowered for alias in COVERAGE_LABELS)


def _read_count(text: str) -> int | None:
    """Read a physical count. Never routed through the money parser."""
    groups = _COUNT_DIGITS.findall(text)
    if not groups:
        return None
    digits = max((group.replace(",", "") for group in groups), key=len)
    return int(digits) if digits.isdigit() else None


def parse_dashboard(
    markup: str,
    *,
    as_of: date,
    fy: str | None = None,
    unit_hint: Unit | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """Parse the coverage and funding dashboard.

    Returns ``(fund_rows, coverage, parse_errors, columns_seen)``. Fund rows
    become RELEASE and UTILIZATION facts; coverage counts are physical progress
    kept in run metrics only.
    """
    document = soup_of(markup)
    page_text = document.get_text(" ", strip=True)
    resolved_fy = fy or _fy_from_text(page_text) or fy_of(as_of)
    caption_unit = unit_hint or parse_unit_hint(page_text[:3000])

    fund_rows: list[dict[str, Any]] = []
    coverage: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    columns: list[str] = []

    target: list[list[str]] = []
    for table in document.find_all("table"):
        candidate = table_rows(table)
        if not candidate:
            continue
        header = " ".join(candidate[0]).lower()
        if all(word in header for word in FUND_TABLE_HEADERS):
            target = candidate
            columns = [clean_cell(cell) for cell in candidate[0]]
            break

    if target:
        amount_index = next(
            (index for index, name in enumerate(columns) if "amount" in name.lower()), 1
        )
        column_unit = parse_unit_hint(columns[amount_index]) or caption_unit
        for record in target[1:]:
            if len(record) <= amount_index:
                continue
            label = clean_cell(record[0])
            stage = classify_stage(label)
            if stage is None:
                continue
            cell = clean_cell(record[amount_index])
            try:
                amount = parse_amount_cr(cell, unit_hint=column_unit)
            except AmountParseError as exc:
                errors.append(
                    {
                        "reason": str(exc),
                        "stage_hint": stage,
                        "raw_context": {"label": label, "cell": cell, "columns": columns},
                    }
                )
                continue
            if not isinstance(amount, Decimal):
                continue
            fund_rows.append(
                {
                    "stage": stage,
                    "label_raw": label,
                    "fy": resolved_fy,
                    "amount_inr_cr": amount,
                    "as_of": as_of,
                    "is_cumulative": True,
                }
            )
    else:
        log.warning("jjm.funding_table_not_found")

    # Coverage tiles: a count of tap connections. Kept as physical progress,
    # never converted to a money amount.
    for tile in document.select("[class*=stat], [class*=tile], [class*=card], [class*=count]"):
        tile_text = clean_cell(tile.get_text(" ", strip=True))
        if not tile_text or len(tile_text) > 160:
            continue
        if _is_coverage_label(tile_text):
            count = _read_count(tile_text)
            if count is not None:
                coverage.append({"label": tile_text, "count": count})

    return fund_rows, coverage, errors, columns


def to_facts(rows: list[JjmFundingRow]) -> list[FiscalFactRow]:
    """Map validated funding rows to RELEASE and UTILIZATION facts."""
    facts: list[FiscalFactRow] = []
    for row in rows:
        facts.append(
            FiscalFactRow(
                fy=row.fy,
                entity_type="scheme",
                entity_id=SCHEME_ID,
                stage=row.stage,
                head="total",
                period_end=min(row.as_of, fy_end(row.fy)),
                is_cumulative=True,
                amount_inr_cr=row.amount_inr_cr,
                extraction_method="html_table",
                is_provisional=True,
            )
        )
    return facts


def run(
    *,
    conn: psycopg.Connection[dict[str, Any]] | None = None,
    client: PoliteClient | None = None,
    dry_run: bool = False,
    url: str | None = None,
    as_of: date | None = None,
    fy: str | None = None,
) -> RunOutcome:
    """Seven steps, in the order docs/02 section 5 fixes them."""
    outcome = RunOutcome(source_id=SOURCE_ID, status="ok")
    owns_client = client is None
    http = client or PoliteClient()
    snapshot_date = as_of or datetime.now(UTC).date()

    try:
        with PipelineRun(SOURCE_ID, conn, dry_run=dry_run) as run_ctx:
            ingested = ingest_url(
                url or URLS["dashboard"],
                source_id=SOURCE_ID,
                client=http,
                run=run_ctx,
                conn=conn,
                document_date=snapshot_date,
            )
            outcome.artifacts.append(ingested.artifact.key)

            fund_rows, coverage, parse_errors, columns = parse_dashboard(
                ingested.text, as_of=snapshot_date, fy=fy
            )

            validated = validate_rows(
                fund_rows, JjmFundingRow, source_id=SOURCE_ID, allow_empty=True
            )
            outcome.rows_parsed = len(validated)
            outcome.parse_errors = len(parse_errors)

            metrics = RunMetrics(
                row_count=len(validated),
                total_amount_inr_cr=(
                    sum((row.amount_inr_cr for row in validated), Decimal(0)) if validated else None
                ),
                columns=tuple(columns),
                parse_error_count=len(parse_errors),
                extra={
                    "as_of": snapshot_date.isoformat(),
                    "stages_seen": sorted({row.stage for row in validated}),
                    # Physical coverage, recorded for the ops page, never as money.
                    "coverage": coverage,
                },
            )
            run_ctx.set_run_metrics(metrics)

            findings = sanity_check(metrics, run_ctx.baseline())
            outcome.drift = [finding.to_jsonable() for finding in findings]
            run_ctx.abort_if_drifted(findings)

            facts = to_facts(validated)
            if conn is not None and not run_ctx.dry_run and ingested.source_record_id is not None:
                from pipelines.lib.db import (
                    record_parse_errors,
                    refresh_materialized_views,
                    upsert_fiscal_facts,
                )

                outcome.facts_written = upsert_fiscal_facts(
                    conn, facts, source_record_id=ingested.source_record_id
                )
                record_parse_errors(
                    conn,
                    parse_errors,
                    source_record_id=ingested.source_record_id,
                    pipeline_run_id=run_ctx.run_id,
                )
                refresh_materialized_views(conn)
            else:
                outcome.notes.append("dry run: nothing written")

            outcome.notes.append(
                "Central Release is recorded as RELEASE and Total Expenditure as UTILIZATION. "
                "Tap-connection coverage is a physical count, kept in metrics, never as money."
            )
            run_ctx.metric(facts_written=outcome.facts_written, coverage_metrics=len(coverage))

        outcome.status = run_ctx.status
    finally:
        if owns_client:
            http.close()

    return outcome
