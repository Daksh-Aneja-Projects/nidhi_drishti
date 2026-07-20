"""Odisha state budget, Finance Department (finance.odisha.gov.in).

The second v2 state-budget source (docs/12). Odisha publishes a Budget at a
Glance alongside the annual budget, with the same three-column shape as most
states: the completed year's Accounts, the current year's Revised Estimate and
the coming year's Budget Estimate.

Odisha differs from Karnataka in two ways that this module handles rather than
assumes:

* it labels the completed year's column "Actuals" and sometimes carries a
  fourth "Provisional Actuals" column, which is read into an EXPENDITURE fact
  flagged provisional so a later audited figure supersedes it cleanly;
* its expenditure side is often split into "Programme Expenditure" and
  "Administrative Expenditure" as well as the revenue/capital rows. Only the
  revenue, capital and total expenditure rows are read; the programme split is a
  documented gap in docs/12 rather than a silent guess.

The same discipline as every other source applies: the unit is read from the
caption, all URLs live in one constant, and a 404 or restructured table raises a
drift alert rather than writing anything. Facts are written only under
entity_type = 'state' (entity_id = 'st-odisha'), keeping a Centrally Sponsored
Scheme's state share out of the Union scheme ledger (docs/12, the CSS rule).
"""

from __future__ import annotations

import re
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
from pipelines.parsers.fy_dates import fy_end, fy_from_indian_label, fy_start
from pipelines.parsers.inr_amounts import (
    AmountParseError,
    Unit,
    parse_amount_cr,
    parse_unit_hint,
)
from pipelines.parsers.text_norm import clean_cell, normalise_org_name
from pipelines.sources._common import RunOutcome, soup_of, table_rows

log = structlog.get_logger(__name__)

SOURCE_ID = "state_odisha"

STATE_ID = "st-odisha"

URLS: dict[str, str] = {
    "home": "https://finance.odisha.gov.in/",
    "budget_at_a_glance": "https://finance.odisha.gov.in/budget/budget-at-a-glance",
    # Odisha also mirrors budget data on a dedicated portal.
    "odisha_budget_portal": "https://odishabudget.gov.in/",
}

#: Stage words per column. "Provisional" flows through as an actual, tagged
#: provisional so a later audited figure supersedes it.
_STAGE_MARKERS: dict[str, tuple[str, ...]] = {
    "BE": ("budget estimate", "budget estimates", "b.e", "be"),
    "RE": ("revised estimate", "revised estimates", "r.e", "re"),
    "ACTUAL": ("actuals", "actual", "accounts", "account"),
}

#: The completed-year columns Odisha marks as not yet audited.
_PROVISIONAL_MARKERS: tuple[str, ...] = ("provisional", "prov.", "unaudited")

_EXPENDITURE_ROWS: dict[str, tuple[str, ...]] = {
    "total": ("total expenditure", "total disbursement", "total disbursements"),
    "revenue": ("revenue expenditure",),
    "capital": ("capital expenditure",),
}

_YEAR_TOKEN = re.compile(r"\d{4}\s*[-/]\s*\d{2,4}")


class OdishaBudgetRow(BaseModel):
    """One expenditure figure from Odisha's Budget at a Glance."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    item_raw: str = Field(min_length=2)
    fy: str = Field(pattern=r"^FY\d{4}$")
    stage: Literal["BE", "RE", "EXPENDITURE"]
    head: Literal["revenue", "capital", "total"]
    amount_inr_cr: Decimal
    is_provisional: bool = False


def _find_unit(markup: str) -> Unit | None:
    text = soup_of(markup).get_text(" ", strip=True)
    for window in (text[:2000], text):
        unit = parse_unit_hint(window)
        if unit is not None:
            return unit
    return None


def _column_stage_fy(cell: str) -> tuple[str, str, bool] | None:
    """Map a header cell to ``(stage, fy, is_provisional)`` or None."""
    text = clean_cell(cell)
    lowered = text.lower()
    year_match = _YEAR_TOKEN.search(text)
    if not year_match:
        return None
    try:
        fy = fy_from_indian_label(year_match.group(0))
    except Exception:  # noqa: BLE001 - a header cell that is not a year pair
        return None
    provisional = any(marker in lowered for marker in _PROVISIONAL_MARKERS)
    for stage, markers in _STAGE_MARKERS.items():
        if any(re.search(rf"\b{re.escape(marker)}\b", lowered) for marker in markers):
            return stage, fy, provisional
    # A bare "Provisional 2024-25" column with no other stage word is still the
    # completed-year actual.
    if provisional:
        return "ACTUAL", fy, True
    return None


def _row_head(label: str) -> str | None:
    normalised = normalise_org_name(label)
    for head, markers in _EXPENDITURE_ROWS.items():
        if any(normalised == marker or normalised.startswith(marker) for marker in markers):
            return head
    return None


def parse_budget_glance(
    markup: str,
    *,
    unit_hint: Unit | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """Parse Odisha's Budget at a Glance into expenditure rows.

    Pure, header-driven, and returns ``(rows, parse_errors, columns_seen)`` so
    the test suite exercises the real logic against a fixture.
    """
    document = soup_of(markup)
    unit = unit_hint or _find_unit(markup)

    target: list[list[str]] = []
    columns: list[str] = []
    stage_columns: dict[int, tuple[str, str, bool]] = {}

    for table in document.find_all("table"):
        rows = table_rows(table)
        if not rows:
            continue
        header = rows[0]
        candidate = {
            index: mapped
            for index, cell in enumerate(header)
            if (mapped := _column_stage_fy(cell)) is not None
        }
        if not candidate:
            continue
        if any(_row_head(clean_cell(r[0])) for r in rows[1:] if r):
            target = rows
            columns = [clean_cell(cell) for cell in header]
            stage_columns = candidate
            break

    if not target:
        log.warning("state_odisha.budget_glance_table_not_found")
        return [], [], columns

    rows_out: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    for row in target[1:]:
        if not row:
            continue
        label = clean_cell(row[0])
        head = _row_head(label)
        if head is None:
            continue
        for index, (stage, fy, provisional) in stage_columns.items():
            if index >= len(row):
                continue
            cell = clean_cell(row[index])
            try:
                amount = parse_amount_cr(cell, unit_hint=unit)
            except AmountParseError as exc:
                errors.append(
                    {
                        "reason": str(exc),
                        "stage_hint": stage,
                        "raw_context": {"item": label, "cell": cell, "columns": columns},
                    }
                )
                continue
            if not isinstance(amount, Decimal):
                continue
            rows_out.append(
                {
                    "item_raw": label,
                    "fy": fy,
                    "stage": "EXPENDITURE" if stage == "ACTUAL" else stage,
                    "head": head,
                    "amount_inr_cr": amount,
                    "is_provisional": provisional,
                }
            )

    return rows_out, errors, columns


def to_facts(rows: list[OdishaBudgetRow]) -> list[FiscalFactRow]:
    """Map validated rows to canonical state facts under st-odisha."""
    facts: list[FiscalFactRow] = []
    for row in rows:
        if row.stage == "EXPENDITURE":
            facts.append(
                FiscalFactRow(
                    fy=row.fy,
                    entity_type="state",
                    entity_id=STATE_ID,
                    stage="EXPENDITURE",
                    head=row.head,
                    period_start=fy_start(row.fy),
                    period_end=fy_end(row.fy),
                    is_cumulative=True,
                    amount_inr_cr=row.amount_inr_cr,
                    extraction_method="html_table",
                    is_provisional=row.is_provisional,
                )
            )
        else:
            facts.append(
                FiscalFactRow(
                    fy=row.fy,
                    entity_type="state",
                    entity_id=STATE_ID,
                    stage=row.stage,
                    head=row.head,
                    amount_inr_cr=row.amount_inr_cr,
                    extraction_method="html_table",
                )
            )
    return facts


def run(
    *,
    conn: psycopg.Connection[dict[str, Any]] | None = None,
    client: PoliteClient | None = None,
    dry_run: bool = False,
    url: str | None = None,
) -> RunOutcome:
    """Seven steps, in the order docs/02 section 5 fixes them."""
    from pipelines.lib.validation import validate_rows

    outcome = RunOutcome(source_id=SOURCE_ID, status="ok")
    owns_client = client is None
    http = client or PoliteClient()

    try:
        with PipelineRun(SOURCE_ID, conn, dry_run=dry_run) as run_ctx:
            ingested = ingest_url(
                url or URLS["budget_at_a_glance"],
                source_id=SOURCE_ID,
                client=http,
                run=run_ctx,
                conn=conn,
            )
            outcome.artifacts.append(ingested.artifact.key)

            rows, parse_errors, columns = parse_budget_glance(ingested.text)

            validated = validate_rows(rows, OdishaBudgetRow, source_id=SOURCE_ID, allow_empty=True)
            outcome.rows_parsed = len(validated)
            outcome.parse_errors = len(parse_errors)

            be_total = sum(
                (
                    row.amount_inr_cr
                    for row in validated
                    if row.stage == "BE" and row.head == "total"
                ),
                Decimal(0),
            )
            metrics = RunMetrics(
                row_count=len(validated),
                total_amount_inr_cr=be_total if validated else None,
                columns=tuple(columns),
                parse_error_count=len(parse_errors),
                extra={"state_id": STATE_ID},
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

            run_ctx.metric(facts_written=outcome.facts_written, state_id=STATE_ID)

        outcome.status = run_ctx.status
    finally:
        if owns_client:
            http.close()

    return outcome
