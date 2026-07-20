"""MGNREGA public financial progress reports (nrega.nic.in).

The Mahatma Gandhi National Rural Employment Guarantee Scheme publishes rich
public MIS reports of physical and financial progress, national, state, and
district wise. This module targets the national and state-level *financial*
progress report, which is the only part that carries money we can place in the
canonical fiscal model.

Two figures on that report matter, and they are two *different* fiscal stages
that must never be conflated (CLAUDE.md principle 2, docs/04 section 1):

* **Central Release** is money leaving the Union, so it is the RELEASE stage.
* **Total Expenditure** is what the implementing agencies (states, panchayats)
  actually spent, so it is the UTILIZATION stage. It is explicitly *not*
  EXPENDITURE, which this system reserves for CGA accounted actuals; calling an
  implementing-agency spend "expenditure" would let it be compared against a CGA
  number that means something else.

The report is scheme-scoped: the whole site is MGNREGA, so every figure maps to
the one fixed :data:`SCHEME_ID`, which already exists in db/seed/04_schemes.sql.
There is no name resolution to do and none is invented.

Two further properties drive the code:

* the financial figures are **cumulative from 1 April**, so they are stored with
  ``is_cumulative = true`` and are never summed across two snapshots;
* the report is published in lakh or crore depending on the statement, with the
  unit in the column header or the caption. The unit is read from the document;
  a report whose unit cannot be found produces parse errors, not a guess
  (docs/04 section 5, enforced by parsers/inr_amounts.py).
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

SOURCE_ID = "mgnrega"

#: The scheme every figure from this portal belongs to. It already exists in
#: db/seed/04_schemes.sql; this module never invents a scheme id.
SCHEME_ID = "sch-mgnrega"

#: Every entry point for this source, in one place. These URLs are not verified
#: live; the nrega.nic.in MIS reorganises often. When one breaks, a 404 surfaces
#: as a failed run with an alert, and a served-but-restructured page parses to
#: zero rows which the drift check turns into a high-severity finding. Either
#: way the fix is a one-place edit here, and neither writes garbage.
URLS: dict[str, str] = {
    "home": "https://nrega.nic.in/",
    # National and state-wise financial progress / "at a glance" report.
    "financial_progress": "https://nrega.nic.in/netnrega/all_lvl_details_dashboard_new.aspx",
}

#: Header words that identify the financial statement. Matching on text rather
#: than table position survives the portal adding a banner or a column.
FINANCIAL_TABLE_HEADERS = ("particulars", "amount")

Stage = Literal["RELEASE", "UTILIZATION"]

#: Row labels mapped to the fiscal stage they represent. The aliases are
#: deliberately specific: "central release" must not catch a "State Release"
#: line (state share is not a Union outflow), and "total expenditure" must not
#: catch a "Percentage Utilization" line. Anything not matched here is skipped,
#: never guessed at a stage.
STAGE_LABELS: dict[Stage, tuple[str, ...]] = {
    "RELEASE": ("central release", "central fund released", "release of central share"),
    "UTILIZATION": ("total expenditure", "total exp."),
}

#: Labels that look money-ish but are ratios or balances, not a fiscal stage.
#: Skipped before any amount parsing so a "72.5%" cell never becomes a parse
#: error.
_NON_STAGE_MARKERS = ("percentage", "percent", "% of", "balance", "available")

_INDIAN_FY = re.compile(r"\b(\d{4}\s*[-/]\s*\d{2,4})\b")


class MgnregaFinancialRow(BaseModel):
    """One financial-progress figure, tagged with the stage it belongs to.

    The schema is the drift tripwire: if nrega.nic.in restructures the
    statement, rows stop validating here and the run aborts before anything is
    written.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    stage: Stage
    label_raw: str = Field(min_length=2)
    fy: str = Field(pattern=r"^FY\d{4}$")
    amount_inr_cr: Decimal
    as_of: date
    is_cumulative: bool = True


def _fy_from_text(text: str) -> str | None:
    """Read '2025-26' out of the page and convert it to our FY label."""
    match = _INDIAN_FY.search(text)
    if not match:
        return None
    try:
        return fy_from_indian_label(match.group(1))
    except Exception:  # noqa: BLE001 - not every 4-digit pair is a fiscal year
        return None


def classify_stage(label: str) -> Stage | None:
    """Map a row label to a fiscal stage, or None when it is neither.

    Returning None is the common, correct answer: most rows on the financial
    statement (total available fund, wages, material, percentages) are not a
    stage we model, and they are skipped rather than forced into one.
    """
    lowered = label.lower()
    if any(marker in lowered for marker in _NON_STAGE_MARKERS):
        return None
    for stage, aliases in STAGE_LABELS.items():
        if any(alias in lowered for alias in aliases):
            return stage
    return None


def parse_financial_progress(
    markup: str,
    *,
    as_of: date,
    fy: str | None = None,
    unit_hint: Unit | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """Parse the national financial progress statement.

    Returns ``(rows, parse_errors, columns_seen)``. Pure: takes markup, returns
    data, which is what lets the test suite run the real parser against a
    fixture of the real page with no network.
    """
    document = soup_of(markup)
    page_text = document.get_text(" ", strip=True)
    resolved_fy = fy or _fy_from_text(page_text) or fy_of(as_of)
    caption_unit = unit_hint or parse_unit_hint(page_text[:3000])

    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    columns: list[str] = []

    target: list[list[str]] = []
    for table in document.find_all("table"):
        candidate = table_rows(table)
        if not candidate:
            continue
        header = " ".join(candidate[0]).lower()
        if all(word in header for word in FINANCIAL_TABLE_HEADERS):
            target = candidate
            columns = [clean_cell(cell) for cell in candidate[0]]
            break

    if not target:
        # No structural exception here: an empty result becomes a zero-row
        # metric, which the drift check turns into a high-severity finding with
        # a readable explanation instead of an "index out of range" traceback.
        log.warning("mgnrega.financial_table_not_found")
        return rows, errors, columns

    amount_index = next(
        (index for index, name in enumerate(columns) if "amount" in name.lower()), 1
    )
    # The unit can sit in the amount column header ("Amount (Rs. in Lakh)") or
    # only in the caption. The header wins where present.
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
            # Genuinely not reported. Skipped rather than written as zero.
            continue
        rows.append(
            {
                "stage": stage,
                "label_raw": label,
                "fy": resolved_fy,
                "amount_inr_cr": amount,
                "as_of": as_of,
                "is_cumulative": True,
            }
        )

    return rows, errors, columns


def to_facts(rows: list[MgnregaFinancialRow]) -> list[FiscalFactRow]:
    """Map validated rows to RELEASE and UTILIZATION facts for MGNREGA.

    ``period_end`` is the date the report was read, because the figure is
    "released, or spent, as at this date". It is capped at the fiscal year end so
    a stale snapshot fetched after the year closes still lands inside the year it
    reports on. ``period_start`` is left null, matching the PFMS release pattern:
    the snapshot is a running total to a date, not a bounded window.
    """
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
                # Portal figures are as-published and provisional until the
                # scheme's audited accounts confirm them.
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
            # 1 + 2. fetch and store the raw artifact, then record provenance.
            ingested = ingest_url(
                url or URLS["financial_progress"],
                source_id=SOURCE_ID,
                client=http,
                run=run_ctx,
                conn=conn,
                document_date=snapshot_date,
            )
            outcome.artifacts.append(ingested.artifact.key)

            # 3. parse.
            rows, parse_errors, columns = parse_financial_progress(
                ingested.text, as_of=snapshot_date, fy=fy
            )

            # 4. validate. Failure raises SchemaDriftError and aborts the write.
            validated = validate_rows(
                rows, MgnregaFinancialRow, source_id=SOURCE_ID, allow_empty=True
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
                },
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

            outcome.notes.append(
                "Central Release is recorded as RELEASE and Total Expenditure as UTILIZATION; "
                "the two fiscal stages are never conflated."
            )
            # 7. record_run happens on context exit.
            run_ctx.metric(facts_written=outcome.facts_written)

        # Status comes from the run context, which has just written the
        # pipeline_run row. Informational findings are recorded; only warn and
        # high make a run a drift alert.
        outcome.status = run_ctx.status
    finally:
        if owns_client:
            http.close()

    return outcome
