"""Karnataka state budget, Finance Department (finance.karnataka.gov.in).

The first of the v2 state-budget sources (docs/12). Karnataka publishes a
"Budget at a Glance" each year with a small summary table: revenue and capital
receipts and expenditure across three columns, the completed year's Accounts,
the current year's Revised Estimate and the coming year's Budget Estimate.

This module reads the expenditure rows of that table into canonical facts under
entity_type = 'state', entity_id = 'st-karnataka':

* the Budget Estimate and Revised Estimate columns become BE and RE authority
  facts (annual, no period);
* the Accounts column becomes an EXPENDITURE fact for the full completed year
  (period April to March, is_cumulative = true, so mv_state_summary reads it the
  same way it reads a Union year-to-date figure).

Two hard rules carried over from the Union sources:

* the unit is read from the document caption, never assumed. Karnataka publishes
  in rupees crore, but a table whose unit we cannot find produces parse errors,
  not guesses (docs/04 section 5);
* every URL lives in one constant. The exact document path is not verified in
  code, so a 404 or a restructured table raises a clear drift alert rather than
  writing anything (docs/12).

Karnataka's spending is recorded ONLY under entity_type = 'state'. A Centrally
Sponsored Scheme's state share is never written into the Union scheme ledger,
because mv_scheme_summary would then sum it on top of the Union central share for
the same scheme. The source is registered with jurisdiction = 'state', and the
`state_source_in_union_ledger` invariant guards the rule (docs/12, the CSS rule).
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

SOURCE_ID = "state_karnataka"

#: The stable id this source writes for. Fixed, because this module only ever
#: reads Karnataka's budget.
STATE_ID = "st-karnataka"

#: Every entry point in one place. Unverified: the pipeline fails loudly on a
#: 404 or a moved table rather than trusting any of these paths.
URLS: dict[str, str] = {
    "home": "https://finance.karnataka.gov.in/",
    # Budget at a Glance is the summary document this module parses.
    "budget_at_a_glance": "https://finance.karnataka.gov.in/budget/budget-at-a-glance",
    "budget_documents": "https://finance.karnataka.gov.in/budget/budget-documents",
}

#: Column-header words that identify each stage. Matched case-folded against the
#: header cell text alongside a fiscal-year token, so "2025-26 Budget Estimates"
#: and "2025-26 (BE)" both resolve.
_STAGE_MARKERS: dict[str, tuple[str, ...]] = {
    "BE": ("budget estimate", "budget estimates", "b.e", "be"),
    "RE": ("revised estimate", "revised estimates", "r.e", "re"),
    # The completed year's audited figure. Mapped to the EXPENDITURE stage.
    "ACTUAL": ("actuals", "actual", "accounts", "account"),
}

#: Expenditure rows we read, mapped to the revenue/capital/total head. Anything
#: else in the table (receipts, deficits, borrowings) is skipped rather than
#: forced into the expenditure model.
_EXPENDITURE_ROWS: dict[str, tuple[str, ...]] = {
    "total": ("total expenditure", "total disbursement", "total disbursements"),
    "revenue": ("revenue expenditure",),
    "capital": ("capital expenditure",),
}

_YEAR_TOKEN = re.compile(r"\d{4}\s*[-/]\s*\d{2,4}")


class KarnatakaBudgetRow(BaseModel):
    """One expenditure figure from the Budget at a Glance table.

    The schema is the drift tripwire: if Karnataka restructures the statement,
    rows stop validating here and the run aborts before anything is written.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    item_raw: str = Field(min_length=2)
    fy: str = Field(pattern=r"^FY\d{4}$")
    stage: Literal["BE", "RE", "EXPENDITURE"]
    head: Literal["revenue", "capital", "total"]
    amount_inr_cr: Decimal


def _find_unit(markup: str) -> Unit | None:
    """Read the unit from the caption. None is a real answer, not a default."""
    text = soup_of(markup).get_text(" ", strip=True)
    for window in (text[:2000], text):
        unit = parse_unit_hint(window)
        if unit is not None:
            return unit
    return None


def _column_stage_fy(cell: str) -> tuple[str, str] | None:
    """Map one header cell to ``(stage, fy)`` or None when it names neither."""
    text = clean_cell(cell)
    lowered = text.lower()
    year_match = _YEAR_TOKEN.search(text)
    if not year_match:
        return None
    try:
        fy = fy_from_indian_label(year_match.group(0))
    except Exception:  # noqa: BLE001 - a header cell that is not a year pair
        return None
    for stage, markers in _STAGE_MARKERS.items():
        if any(re.search(rf"\b{re.escape(marker)}\b", lowered) for marker in markers):
            return stage, fy
    return None


def _row_head(label: str) -> str | None:
    """Map a row label to a head, or None when it is not an expenditure row."""
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
    """Parse the Budget at a Glance summary into expenditure rows.

    Returns ``(rows, parse_errors, columns_seen)``. Pure: takes markup, returns
    data, so the test suite runs the real parser against a fixture of the page.
    The table is located by matching header cells that carry a fiscal year and a
    stage word, which survives the portal adding a banner or a column.
    """
    document = soup_of(markup)
    unit = unit_hint or _find_unit(markup)

    target: list[list[str]] = []
    columns: list[str] = []
    stage_columns: dict[int, tuple[str, str]] = {}

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
        # A budget-at-a-glance table also has expenditure rows; require at least
        # one so a stray table of year-labelled columns is not mistaken for it.
        if any(_row_head(clean_cell(r[0])) for r in rows[1:] if r):
            target = rows
            columns = [clean_cell(cell) for cell in header]
            stage_columns = candidate
            break

    if not target:
        # An empty result becomes a zero-row metric, which the drift check turns
        # into a high-severity finding with a readable explanation. Raising here
        # would only say "list index out of range".
        log.warning("state_karnataka.budget_glance_table_not_found")
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
        for index, (stage, fy) in stage_columns.items():
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
                # Genuinely not reported. Skipped rather than written as zero.
                continue
            rows_out.append(
                {
                    "item_raw": label,
                    "fy": fy,
                    # The Accounts column is the completed year's expenditure.
                    "stage": "EXPENDITURE" if stage == "ACTUAL" else stage,
                    "head": head,
                    "amount_inr_cr": amount,
                }
            )

    return rows_out, errors, columns


def to_facts(rows: list[KarnatakaBudgetRow]) -> list[FiscalFactRow]:
    """Map validated rows to canonical state facts.

    No entity resolution step: this source reads exactly one state, so the id is
    fixed. The facts are written under entity_type = 'state', which keeps them
    out of the Union scheme and ministry ledgers (docs/12, the CSS rule).
    """
    facts: list[FiscalFactRow] = []
    for row in rows:
        if row.stage == "EXPENDITURE":
            # A state's full-year audited actual: the whole fiscal year, treated
            # as cumulative so mv_state_summary reads it like a year-to-date
            # figure that happens to reach the end of the year.
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
            # 1 + 2. fetch and store the raw artifact, then record provenance.
            ingested = ingest_url(
                url or URLS["budget_at_a_glance"],
                source_id=SOURCE_ID,
                client=http,
                run=run_ctx,
                conn=conn,
            )
            outcome.artifacts.append(ingested.artifact.key)

            # 3. parse.
            rows, parse_errors, columns = parse_budget_glance(ingested.text)

            # 4. validate. Failure raises SchemaDriftError and aborts the write.
            validated = validate_rows(
                rows, KarnatakaBudgetRow, source_id=SOURCE_ID, allow_empty=True
            )
            outcome.rows_parsed = len(validated)
            outcome.parse_errors = len(parse_errors)

            # The BE total is the figure that ends up as the headline; a unit
            # misread turns it into a 100x swing the drift check catches.
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

            # 5. sanity check against recent successful runs.
            findings = sanity_check(metrics, run_ctx.baseline())
            outcome.drift = [finding.to_jsonable() for finding in findings]
            run_ctx.abort_if_drifted(findings)

            # 6. upsert into the canonical store.
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

            # 7. record_run happens on context exit.
            run_ctx.metric(facts_written=outcome.facts_written, state_id=STATE_ID)

        outcome.status = run_ctx.status
    finally:
        if owns_client:
            http.close()

    return outcome
