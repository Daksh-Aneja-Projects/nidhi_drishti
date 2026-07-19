"""Union Budget documents from indiabudget.gov.in.

The denominator of the whole product. Every "percent spent" on the dashboard is
a CGA figure divided by a number that came from here.

Three stages live in these documents and are kept strictly apart, because
conflating them is how a dashboard accuses a ministry of overspending an
allocation Parliament already raised:

* **BE**  Budget Estimate, presented on 1 February;
* **RE**  Revised Estimate for the current year, in the same document;
* **SUPPLEMENTARY** demands for grants, laid during the year, which *add* to the
  authority rather than replacing it.

The Statements of Budget Estimates are PDFs whose tables have no ruling lines,
so extraction confidence is scored and low-confidence tables are handed to the
extraction-assist callable. Numbers are in crore or lakh depending on the
statement, and the unit is read from the document, never assumed.
"""

from __future__ import annotations

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
from pipelines.parsers.fy_dates import fy_from_indian_label
from pipelines.parsers.pdf_table import (
    UNUSABLE_THRESHOLD,
    ExtractedTable,
    ExtractionAssist,
    extract_tables,
    is_total_row,
    rows_to_records,
)
from pipelines.parsers.text_norm import clean_cell, normalise_org_name
from pipelines.sources._common import RunOutcome

log = structlog.get_logger(__name__)

SOURCE_ID = "union_budget"

#: Entry points. The budget portal republishes under a new year path each
#: February and retires the old one, so these are formatted per year where the
#: portal's own scheme allows it and left as landing pages where it does not.
URLS: dict[str, str] = {
    "home": "https://www.indiabudget.gov.in/",
    # Expenditure Budget: statements of budget estimates for every demand.
    "expenditure_budget": "https://www.indiabudget.gov.in/doc/eb/allsbe.pdf",
    # Summary of the same, ministry-wise, which is the table this module wants.
    "expenditure_summary": "https://www.indiabudget.gov.in/doc/eb/sumsbe.pdf",
    # Budget at a Glance, used for the national totals.
    "budget_at_a_glance": "https://www.indiabudget.gov.in/doc/bag/bag1.pdf",
    "documents_index": "https://www.indiabudget.gov.in/doc/eb/allsbe.pdf",
}

#: Column headings the summary statement uses. Real documents abbreviate the
#: year, so the match is on the stage word.
STAGE_COLUMN_MARKERS: dict[str, tuple[str, ...]] = {
    "BE": ("budget", "be"),
    "RE": ("revised", "re"),
}


class BudgetAllocationRow(BaseModel):
    """One ministry-or-demand allocation line from a budget statement."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    demand_no: str | None = None
    entity_raw: str = Field(min_length=2)
    entity_normalised: str = Field(min_length=2)
    fy: str = Field(pattern=r"^FY\d{4}$")
    stage: str = Field(pattern=r"^(BE|RE|SUPPLEMENTARY)$")
    amount_inr_cr: Decimal
    head: str = "total"
    extraction_method: str = "pdf_table"
    page_number: int | None = None
    confidence: float | None = None


def locate_stage_columns(header: tuple[str, ...]) -> dict[str, int]:
    """Map BE and RE to column indices using the header text.

    Position-based column mapping is what breaks when a statement gains a
    column. Reading the header means a new column is a drift finding rather than
    a year's worth of figures landing in the wrong stage.
    """
    found: dict[str, int] = {}
    for index, cell in enumerate(header):
        text = clean_cell(cell).lower()
        if not text:
            continue
        for stage, markers in STAGE_COLUMN_MARKERS.items():
            if stage in found:
                continue
            if any(marker in text.split() or marker in text for marker in markers):
                found[stage] = index
    return found


def fy_from_header(header: tuple[str, ...], fallback: str | None = None) -> str | None:
    """Read '2025-26' out of a column header and convert it to our FY label."""
    import re

    for cell in header:
        match = re.search(r"(\d{4}\s*[-/]\s*\d{2,4})", clean_cell(cell))
        if match:
            try:
                return fy_from_indian_label(match.group(1))
            except Exception:  # noqa: BLE001 - not every 4-digit pair is a year pair
                continue
    return fallback


def parse_allocation_tables(
    tables: list[ExtractedTable],
    *,
    fy: str | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """Turn scored PDF tables into allocation rows.

    A table below :data:`UNUSABLE_THRESHOLD` is not parsed at all. Its rows go to
    the parse-error queue with the confidence score attached, so a human can see
    that the document changed rather than a chart quietly losing a ministry.
    """
    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    columns: list[str] = []

    for table in tables:
        if table.header:
            columns = list(table.header)
        if table.confidence.is_unusable:
            errors.append(
                {
                    "reason": (
                        f"Table extraction confidence {table.confidence.score} is below the "
                        f"usable threshold {UNUSABLE_THRESHOLD}: "
                        f"{'; '.join(table.confidence.reasons)}"
                    ),
                    "stage_hint": "BE",
                    "raw_context": {
                        "page": table.page_number,
                        "header": list(table.header),
                        "first_rows": table.rows[:3],
                    },
                }
            )
            continue

        stage_columns = locate_stage_columns(table.header)
        if not stage_columns:
            errors.append(
                {
                    "reason": "No Budget Estimate or Revised Estimate column found in the header.",
                    "stage_hint": "BE",
                    "raw_context": {"page": table.page_number, "header": list(table.header)},
                }
            )
            continue

        table_fy = fy_from_header(table.header, fy)
        if table_fy is None:
            errors.append(
                {
                    "reason": "The table header states no fiscal year, so its figures cannot be "
                    "placed in one.",
                    "stage_hint": "BE",
                    "raw_context": {"page": table.page_number, "header": list(table.header)},
                }
            )
            continue

        records, cell_errors = rows_to_records(table, value_columns=stage_columns)
        errors.extend(cell_errors)

        for record in records:
            label = str(record["label"])
            if is_total_row(label):
                # Grand-total rows sit inside these statements. Ingesting them
                # alongside their own components would double the total.
                continue
            for stage in stage_columns:
                amount = record.get(stage)
                if amount is None:
                    continue
                rows.append(
                    {
                        "demand_no": _demand_number(label),
                        "entity_raw": label,
                        "entity_normalised": normalise_org_name(label),
                        "fy": table_fy,
                        "stage": stage,
                        "amount_inr_cr": amount,
                        "head": "total",
                        "extraction_method": table.extraction_method,
                        "page_number": table.page_number,
                        "confidence": table.confidence.score,
                    }
                )

    return rows, errors, columns


def _demand_number(label: str) -> str | None:
    import re

    match = re.match(r"^\s*(\d{1,3})[.)\s]", label)
    return match.group(1) if match else None


def to_facts(
    rows: list[BudgetAllocationRow],
    *,
    resolve_ministry: dict[str, str] | None = None,
) -> tuple[list[FiscalFactRow], list[dict[str, Any]]]:
    aliases = resolve_ministry or {}
    facts: list[FiscalFactRow] = []
    unresolved: list[dict[str, Any]] = []
    for row in rows:
        entity_id = aliases.get(row.entity_normalised)
        if entity_id is None:
            unresolved.append(
                {
                    "reason": "No entity_alias maps this demand or ministry name to a stable id.",
                    "stage_hint": row.stage,
                    "raw_context": {"entity_raw": row.entity_raw, "demand_no": row.demand_no},
                }
            )
            continue
        facts.append(
            FiscalFactRow(
                fy=row.fy,
                entity_type="ministry",
                entity_id=entity_id,
                stage=row.stage,  # type: ignore[arg-type]
                head="total",
                amount_inr_cr=row.amount_inr_cr,
                extraction_method=row.extraction_method,  # type: ignore[arg-type]
                is_provisional=False,
            )
        )
    return facts, unresolved


def run(
    *,
    conn: psycopg.Connection[dict[str, Any]] | None = None,
    client: PoliteClient | None = None,
    dry_run: bool = False,
    url: str | None = None,
    fy: str | None = None,
    assist: ExtractionAssist | None = None,
    resolve_ministry: dict[str, str] | None = None,
) -> RunOutcome:
    """Seven steps, in the order docs/02 section 5 fixes them."""
    outcome = RunOutcome(source_id=SOURCE_ID, status="ok")
    owns_client = client is None
    http = client or PoliteClient()

    try:
        with PipelineRun(SOURCE_ID, conn, dry_run=dry_run) as run_ctx:
            ingested = ingest_url(
                url or URLS["expenditure_summary"],
                source_id=SOURCE_ID,
                client=http,
                run=run_ctx,
                conn=conn,
            )
            outcome.artifacts.append(ingested.artifact.key)

            tables = extract_tables(ingested.content, assist=assist)
            rows, parse_errors, columns = parse_allocation_tables(tables, fy=fy)

            validated = validate_rows(
                rows, BudgetAllocationRow, source_id=SOURCE_ID, allow_empty=True
            )
            outcome.rows_parsed = len(validated)
            outcome.parse_errors = len(parse_errors)

            be_total = sum(
                (row.amount_inr_cr for row in validated if row.stage == "BE"), Decimal(0)
            )
            metrics = RunMetrics(
                row_count=len(validated),
                total_amount_inr_cr=be_total if validated else None,
                columns=tuple(columns),
                parse_error_count=len(parse_errors),
                extra={"tables_extracted": len(tables)},
            )
            run_ctx.set_run_metrics(metrics)

            findings = sanity_check(metrics, run_ctx.baseline())
            outcome.drift = [finding.to_jsonable() for finding in findings]
            run_ctx.abort_if_drifted(findings)

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

            run_ctx.metric(facts_written=outcome.facts_written, unresolved=len(unresolved))

        # Status comes from the run context, which has just written the
        # pipeline_run row. Informational findings are recorded; only warn and
        # high make a run a drift alert.
        outcome.status = run_ctx.status
    finally:
        if owns_client:
            http.close()

    return outcome
