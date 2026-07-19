"""Monthly Accounts of the Union Government, Controller General of Accounts.

This is the primary "spent so far" source: official, citable, monthly, and about
two months behind. Everything the dashboard says about expenditure comes from
here.

Two properties of this source drive the whole module:

* the figures are **cumulative from 1 April**. "April-November 2025" is eight
  months of spending, not November's. They are stored with
  ``is_cumulative = true`` and de-cumulated in a view, never summed;
* the figures are **provisional** and are revised in later releases, so every
  fact is written with ``is_provisional = true`` and revisions supersede rather
  than overwrite.

The published tables are in lakh or crore depending on the statement, and the
unit is stated in the caption rather than the column header. The unit is read
from the document; a table whose unit we cannot find produces parse errors, not
guesses.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

import psycopg
import structlog
from pydantic import BaseModel, ConfigDict, Field

from pipelines.lib.drift import RunMetrics, sanity_check
from pipelines.lib.fetch import PoliteClient
from pipelines.lib.ingest import ingest_url
from pipelines.lib.models import FiscalFactRow
from pipelines.lib.runs import PipelineRun
from pipelines.lib.validation import validate_rows
from pipelines.parsers.fy_dates import ReportingPeriod, parse_month_label
from pipelines.parsers.inr_amounts import (
    CRORE,
    AmountParseError,
    Unit,
    parse_amount_cr,
    parse_unit_hint,
)
from pipelines.parsers.text_norm import clean_cell, normalise_org_name
from pipelines.sources._common import RunOutcome, soup_of, table_rows

log = structlog.get_logger(__name__)

SOURCE_ID = "cga_monthly"

#: Every entry point for this source, in one place. Government portals
#: reorganise; when this breaks, it breaks here and nowhere else.
URLS: dict[str, str] = {
    # Landing page listing each month's accounts. Verified as the institution's
    # published entry point; the exact path has changed before and will again.
    "monthly_index": "https://cga.nic.in/MonthlyReport.aspx",
    "accounts_at_a_glance": "https://cga.nic.in/Report/MonthlyAccount.aspx",
}

#: Header words that identify the ministry-wise expenditure table. Matching on
#: text rather than position survives a portal adding a banner or a column.
EXPENDITURE_TABLE_HEADERS = ("ministry", "expenditure")

#: Rows that are subtotals inside the table. Ingesting them as if they were
#: ministries would double the national total.
TOTAL_ROW_MARKERS = ("total", "grand total", "grand-total")


class CgaExpenditureRow(BaseModel):
    """One ministry's cumulative expenditure as the Monthly Accounts report it.

    The schema is the drift tripwire: if CGA restructures the statement, rows
    stop validating here and the run aborts before anything is written.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    ministry_raw: str = Field(min_length=2)
    ministry_normalised: str = Field(min_length=2)
    period_label: str
    period_start: date
    period_end: date
    fy: str = Field(pattern=r"^FY\d{4}$")
    expenditure_inr_cr: Decimal
    head: str = "total"
    is_cumulative: bool = True


def find_unit(markup: str) -> Unit | None:
    """Read the unit from the statement caption.

    CGA puts "(₹ in crore)" above the table rather than inside a column header,
    so the whole page text is searched. Returning None is a real answer and the
    caller turns it into parse errors instead of assuming crore.
    """
    text = soup_of(markup).get_text(" ", strip=True)
    for window in (text[:2000], text):
        unit = parse_unit_hint(window)
        if unit is not None:
            return unit
    return None


def is_total_row(label: str) -> bool:
    normalised = normalise_org_name(label)
    return normalised in TOTAL_ROW_MARKERS or normalised.startswith("total ")


def parse_expenditure_table(
    markup: str,
    *,
    period: ReportingPeriod | None = None,
    unit_hint: Unit | None = None,
    expenditure_column: int = 1,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """Parse the ministry-wise expenditure statement.

    Returns ``(rows, parse_errors, columns_seen)``. Pure: takes markup, returns
    data, touches nothing else, which is what lets the test suite run the real
    parser against a fixture of the real page.
    """
    document = soup_of(markup)
    unit = unit_hint or find_unit(markup)
    resolved_period = period or _period_from_page(document.get_text(" ", strip=True))

    target: list[list[str]] = []
    columns: list[str] = []
    for table in document.find_all("table"):
        rows = table_rows(table)
        if not rows:
            continue
        header = " ".join(rows[0]).lower()
        if all(word in header for word in EXPENDITURE_TABLE_HEADERS):
            target = rows
            columns = [clean_cell(cell) for cell in rows[0]]
            break

    if not target:
        # No structural exception here: an empty result becomes a zero-row
        # metric, which the drift check turns into a high-severity finding with
        # a readable explanation. A raised exception at this point would only
        # say "list index out of range".
        log.warning("cga.expenditure_table_not_found")
        return [], [], columns

    parsed: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    for row in target[1:]:
        if len(row) <= expenditure_column:
            continue
        label = clean_cell(row[0])
        if not label or is_total_row(label):
            continue
        cell = clean_cell(row[expenditure_column])
        try:
            amount = parse_amount_cr(cell, unit_hint=unit)
        except AmountParseError as exc:
            errors.append(
                {
                    "reason": str(exc),
                    "stage_hint": "EXPENDITURE",
                    "raw_context": {"ministry": label, "cell": cell, "columns": columns},
                }
            )
            continue
        if not isinstance(amount, Decimal):
            # Genuinely not reported. Skipped rather than written as zero.
            continue
        if resolved_period is None:
            errors.append(
                {
                    "reason": "The statement does not state the period it covers, so a "
                    "cumulative figure cannot be placed in a month.",
                    "stage_hint": "EXPENDITURE",
                    "raw_context": {"ministry": label, "cell": cell},
                }
            )
            continue

        parsed.append(
            {
                "ministry_raw": label,
                "ministry_normalised": normalise_org_name(label),
                "period_label": resolved_period.label,
                "period_start": resolved_period.period_start,
                "period_end": resolved_period.period_end,
                "fy": resolved_period.fy,
                "expenditure_inr_cr": amount,
                "head": "total",
                "is_cumulative": resolved_period.is_cumulative,
            }
        )

    return parsed, errors, columns


def _period_from_page(text: str) -> ReportingPeriod | None:
    """Find the period the statement covers in its own heading text."""
    import re

    candidates = re.findall(
        r"((?:January|February|March|April|May|June|July|August|September|October|November|"
        r"December)(?:\s*(?:-|to)\s*(?:January|February|March|April|May|June|July|August|"
        r"September|October|November|December))?[, ]+\d{4}(?:\s*-\s*\d{2,4})?)",
        text,
        flags=re.IGNORECASE,
    )
    for candidate in candidates:
        try:
            return parse_month_label(candidate)
        except Exception:  # noqa: BLE001 - a heading that is not a period label
            continue
    return None


def to_facts(
    rows: list[CgaExpenditureRow],
    *,
    resolve_ministry: dict[str, str] | None = None,
) -> tuple[list[FiscalFactRow], list[dict[str, Any]]]:
    """Map validated rows to canonical facts.

    A ministry name that does not resolve to a stable id is *not* written under
    a guessed id. It goes to the parse-error queue and, in the full pipeline, to
    ``alias_review_queue``: attaching spending to the wrong ministry is worse
    than not showing it.
    """
    aliases = resolve_ministry or {}
    facts: list[FiscalFactRow] = []
    unresolved: list[dict[str, Any]] = []

    for row in rows:
        ministry_id = aliases.get(row.ministry_normalised)
        if ministry_id is None:
            unresolved.append(
                {
                    "reason": "No entity_alias maps this ministry name to a stable id.",
                    "stage_hint": "EXPENDITURE",
                    "raw_context": {"ministry_raw": row.ministry_raw},
                }
            )
            continue
        facts.append(
            FiscalFactRow(
                fy=row.fy,
                entity_type="ministry",
                entity_id=ministry_id,
                stage="EXPENDITURE",
                head="total",
                period_start=row.period_start,
                period_end=row.period_end,
                is_cumulative=row.is_cumulative,
                amount_inr_cr=row.expenditure_inr_cr,
                extraction_method="html_table",
                # Monthly Accounts figures are provisional until the annual
                # accounts confirm them. Saying so is part of the provenance.
                is_provisional=True,
            )
        )
    return facts, unresolved


def run(
    *,
    conn: psycopg.Connection[dict[str, Any]] | None = None,
    client: PoliteClient | None = None,
    dry_run: bool = False,
    url: str | None = None,
    resolve_ministry: dict[str, str] | None = None,
) -> RunOutcome:
    """Seven steps, in the order docs/02 section 5 fixes them."""
    outcome = RunOutcome(source_id=SOURCE_ID, status="ok")
    owns_client = client is None
    http = client or PoliteClient()

    try:
        with PipelineRun(SOURCE_ID, conn, dry_run=dry_run) as run_ctx:
            # 1 + 2. fetch and store the raw artifact, then record provenance.
            ingested = ingest_url(
                url or URLS["monthly_index"],
                source_id=SOURCE_ID,
                client=http,
                run=run_ctx,
                conn=conn,
            )
            outcome.artifacts.append(ingested.artifact.key)

            # 3. parse.
            rows, parse_errors, columns = parse_expenditure_table(ingested.text)

            # 4. validate. Failure raises SchemaDriftError and aborts the write.
            validated = validate_rows(
                rows, CgaExpenditureRow, source_id=SOURCE_ID, allow_empty=True
            )
            outcome.rows_parsed = len(validated)
            outcome.parse_errors = len(parse_errors)

            total = sum((row.expenditure_inr_cr for row in validated), Decimal(0))
            metrics = RunMetrics(
                row_count=len(validated),
                total_amount_inr_cr=total if validated else None,
                columns=tuple(columns),
                parse_error_count=len(parse_errors),
            )
            run_ctx.set_run_metrics(metrics)

            # 5. sanity check against recent successful runs.
            findings = sanity_check(metrics, run_ctx.baseline())
            outcome.drift = [finding.to_jsonable() for finding in findings]
            run_ctx.abort_if_drifted(findings)

            # 6. upsert into the canonical store.
            facts, unresolved = to_facts(validated, resolve_ministry=resolve_ministry)
            outcome.parse_errors += len(unresolved)
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
                    [*parse_errors, *unresolved],
                    source_record_id=ingested.source_record_id,
                    pipeline_run_id=run_ctx.run_id,
                )
                refresh_materialized_views(conn)
            else:
                outcome.notes.append("dry run: nothing written")

            # 7. record_run happens on context exit.
            run_ctx.metric(facts_written=outcome.facts_written, unresolved=len(unresolved))
            outcome.status = "drift_alert" if findings else "ok"
    finally:
        if owns_client:
            http.close()

    return outcome
