"""Open Budgets India (CivicDataLab) historical series.

NGO-maintained, cleaned, machine-readable Union budget data. Two uses, and the
second matters more than the first:

1. bootstrap the historical BE and RE series without parsing fifteen years of
   PDFs;
2. **cross-check our own parsing**. When our figure for a ministry-year differs
   materially from theirs, at least one of us is wrong, and finding out which is
   cheaper before publication than after.

Never the sole source for a current-year figure: for anything the Budget or CGA
publishes directly, the government document wins and this is corroboration.
Attribution to CivicDataLab is required and lives in the source registry.
"""

from __future__ import annotations

import csv
import io
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
from pipelines.parsers.fy_dates import fy_from_indian_label, is_fy
from pipelines.parsers.inr_amounts import (
    AmountParseError,
    Unit,
    parse_amount_cr,
    parse_unit_hint,
)
from pipelines.parsers.text_norm import normalise_org_name
from pipelines.sources._common import RunOutcome

log = structlog.get_logger(__name__)

SOURCE_ID = "obi"

URLS: dict[str, str] = {
    "home": "https://openbudgetsindia.org/",
    # Dataset landing pages are per-series; the CSV resource URL is filled in
    # per run because CKAN mints a new resource id for each published revision.
    "union_budget_dataset": "https://openbudgetsindia.org/dataset/union-budget",
}

#: Column names OBI uses. Several spellings appear across their releases, so
#: each logical field lists every alias we have seen.
COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "entity": ("ministry", "ministry_department", "department", "demand", "head"),
    "fy": ("financial_year", "fiscal_year", "year", "fy"),
    "be": ("budget_estimates", "budget_estimate", "be"),
    "re": ("revised_estimates", "revised_estimate", "re"),
    "actuals": ("actuals", "actual", "actual_expenditure"),
}


class ObiBudgetRow(BaseModel):
    """One cleaned allocation line from an Open Budgets India CSV."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    entity_raw: str = Field(min_length=2)
    entity_normalised: str = Field(min_length=2)
    fy: str = Field(pattern=r"^FY\d{4}$")
    stage: str = Field(pattern=r"^(BE|RE)$")
    amount_inr_cr: Decimal


def _match_column(header: list[str], aliases: tuple[str, ...]) -> int | None:
    normalised = [name.strip().lower().replace(" ", "_") for name in header]
    for alias in aliases:
        if alias in normalised:
            return normalised.index(alias)
    # Fall back to a containment match, which catches "budget_estimates_2025_26".
    for index, name in enumerate(normalised):
        if any(alias in name for alias in aliases):
            return index
    return None


def parse_budget_csv(
    payload: str | bytes,
    *,
    unit_hint: Unit | None = None,
    default_fy: str | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """Read an OBI budget CSV into BE and RE rows.

    The unit is taken from the column header where OBI states it, otherwise from
    ``unit_hint``. With neither, every amount cell raises and lands in the
    parse-error queue, which is the correct outcome: OBI publishes some series in
    lakh and some in crore.
    """
    text = payload.decode("utf-8-sig") if isinstance(payload, bytes) else payload
    reader = csv.reader(io.StringIO(text))
    try:
        header = next(reader)
    except StopIteration:
        return [], [], []

    columns = [name.strip() for name in header]
    entity_index = _match_column(columns, COLUMN_ALIASES["entity"])
    fy_index = _match_column(columns, COLUMN_ALIASES["fy"])
    stage_indices = {
        "BE": _match_column(columns, COLUMN_ALIASES["be"]),
        "RE": _match_column(columns, COLUMN_ALIASES["re"]),
    }

    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    if entity_index is None or not any(stage_indices.values()):
        errors.append(
            {
                "reason": "The CSV has no recognisable entity column or no BE/RE column. "
                "Open Budgets India has restructured this series.",
                "stage_hint": "BE",
                "raw_context": {"header": columns},
            }
        )
        return rows, errors, columns

    for line_number, record in enumerate(reader, start=2):
        if not any(cell.strip() for cell in record):
            continue
        entity = record[entity_index].strip() if len(record) > entity_index else ""
        if not entity:
            continue

        fy_value = (
            record[fy_index].strip() if fy_index is not None and len(record) > fy_index else ""
        )
        fy = _resolve_fy(fy_value, default_fy)
        if fy is None:
            errors.append(
                {
                    "reason": f"Row {line_number} carries no readable fiscal year "
                    f"({fy_value!r}).",
                    "stage_hint": "BE",
                    "raw_context": {"row": record},
                }
            )
            continue

        for stage, index in stage_indices.items():
            if index is None or len(record) <= index:
                continue
            column_unit = parse_unit_hint(columns[index]) or unit_hint
            cell = record[index].strip()
            try:
                amount = parse_amount_cr(cell, unit_hint=column_unit)
            except AmountParseError as exc:
                errors.append(
                    {
                        "reason": str(exc),
                        "stage_hint": stage,
                        "raw_context": {
                            "entity": entity,
                            "column": columns[index],
                            "cell": cell,
                            "line": line_number,
                        },
                    }
                )
                continue
            if not isinstance(amount, Decimal):
                continue
            rows.append(
                {
                    "entity_raw": entity,
                    "entity_normalised": normalise_org_name(entity),
                    "fy": fy,
                    "stage": stage,
                    "amount_inr_cr": amount,
                }
            )

    return rows, errors, columns


def _resolve_fy(value: str, default_fy: str | None) -> str | None:
    if value:
        if is_fy(value):
            return value
        try:
            return fy_from_indian_label(value)
        except Exception:  # noqa: BLE001 - the cell may hold something else
            return default_fy
    return default_fy


def compare_with_canonical(
    rows: list[ObiBudgetRow],
    canonical: dict[tuple[str, str, str], Decimal],
    *,
    tolerance: Decimal = Decimal("0.01"),
) -> list[dict[str, Any]]:
    """Cross-check OBI against what we already parsed ourselves.

    ``canonical`` is keyed ``(entity_id, fy, stage)``. Returns one entry per
    material disagreement. This is the reason to ingest OBI at all, so the
    output is meant to be looked at, not just logged.
    """
    discrepancies: list[dict[str, Any]] = []
    for row in rows:
        key = (row.entity_normalised, row.fy, row.stage)
        ours = canonical.get(key)
        if ours is None:
            continue
        if ours == 0:
            continue
        delta = abs(row.amount_inr_cr - ours) / abs(ours)
        if delta > tolerance:
            discrepancies.append(
                {
                    "entity": row.entity_raw,
                    "fy": row.fy,
                    "stage": row.stage,
                    "ours_inr_cr": str(ours),
                    "obi_inr_cr": str(row.amount_inr_cr),
                    "relative_difference": str(delta.quantize(Decimal("0.0001"))),
                }
            )
    return discrepancies


def to_facts(
    rows: list[ObiBudgetRow],
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
                    "reason": "No entity_alias maps this ministry name to a stable id.",
                    "stage_hint": row.stage,
                    "raw_context": {"entity_raw": row.entity_raw},
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
                extraction_method="csv_parse",
            )
        )
    return facts, unresolved


def run(
    *,
    csv_url: str,
    conn: psycopg.Connection[dict[str, Any]] | None = None,
    client: PoliteClient | None = None,
    dry_run: bool = False,
    default_fy: str | None = None,
    unit_hint: Unit | None = None,
    resolve_ministry: dict[str, str] | None = None,
) -> RunOutcome:
    """Seven steps, in the order docs/02 section 5 fixes them."""
    outcome = RunOutcome(source_id=SOURCE_ID, status="ok")
    owns_client = client is None
    http = client or PoliteClient()

    try:
        with PipelineRun(SOURCE_ID, conn, dry_run=dry_run) as run_ctx:
            ingested = ingest_url(
                csv_url, source_id=SOURCE_ID, client=http, run=run_ctx, conn=conn
            )
            outcome.artifacts.append(ingested.artifact.key)

            rows, parse_errors, columns = parse_budget_csv(
                ingested.content, unit_hint=unit_hint, default_fy=default_fy
            )

            validated = validate_rows(rows, ObiBudgetRow, source_id=SOURCE_ID, allow_empty=True)
            outcome.rows_parsed = len(validated)
            outcome.parse_errors = len(parse_errors)

            metrics = RunMetrics(
                row_count=len(validated),
                total_amount_inr_cr=(
                    sum(
                        (row.amount_inr_cr for row in validated if row.stage == "BE"),
                        Decimal(0),
                    )
                    if validated
                    else None
                ),
                columns=tuple(columns),
                parse_error_count=len(parse_errors),
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

            run_ctx.metric(facts_written=outcome.facts_written)

        # Status comes from the run context, which has just written the
        # pipeline_run row. Informational findings are recorded; only warn and
        # high make a run a drift alert.
        outcome.status = run_ctx.status
    finally:
        if owns_client:
            http.close()

    return outcome
