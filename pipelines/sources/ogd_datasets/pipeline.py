"""data.gov.in (OGD platform) datasets.

The one Tier 1 source with a real API and a free key, which makes it the
preferred route wherever a dataset mirrors a document we would otherwise have to
scrape (docs/03 section 1.4). Scraping a PDF that exists as JSON is work we do
not need to do and load the portal does not need to carry.

Two quirks shape this module:

* update cadence varies wildly per resource, so freshness is tracked per dataset
  and a stale resource is reported rather than silently re-ingested as current;
* the API returns figures with the unit in the field name or nowhere at all, so
  each registered dataset declares its unit in :data:`DATASETS`. A dataset with
  no declared unit is not ingested, because a bare number from an API is exactly
  as ambiguous as a bare number in a PDF.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

import psycopg
import structlog
from pydantic import BaseModel, ConfigDict, Field

from pipelines.lib.config import Settings, get_settings
from pipelines.lib.drift import RunMetrics, sanity_check
from pipelines.lib.fetch import PoliteClient
from pipelines.lib.ingest import ingest_url
from pipelines.lib.models import FiscalFactRow
from pipelines.lib.runs import PipelineRun
from pipelines.lib.validation import validate_rows
from pipelines.parsers.fy_dates import fy_from_indian_label, is_fy
from pipelines.parsers.inr_amounts import (
    CRORE,
    AmountParseError,
    Unit,
    parse_amount_cr,
)
from pipelines.parsers.text_norm import normalise_org_name
from pipelines.sources._common import RunOutcome, parse_iso_date

log = structlog.get_logger(__name__)

SOURCE_ID = "ogd"

URLS: dict[str, str] = {
    "resource": "https://api.data.gov.in/resource/{resource_id}",
    "catalog": "https://api.data.gov.in/catalog/{catalog_id}",
    "portal": "https://data.gov.in/",
}


@dataclass(frozen=True, slots=True)
class ColumnSpec:
    """One column of a wide table, and what it means.

    Budget tables published here are frequently wide: the fiscal year and the
    stage are in the column heading, not in a field, so a single row carries an
    actual, two estimates and next year's estimate side by side. Reading such a
    table needs a person to say, once, which column is which. Guessing from a
    heading like ``_2022_2023_br`` is exactly the sort of inference that puts a
    budget estimate in the actuals column.
    """

    field: str
    fy: str
    stage: str
    is_cumulative: bool = False


@dataclass(frozen=True, slots=True)
class DatasetSpec:
    """A registered OGD resource and how to read it.

    ``unit`` is mandatory. The whole point of registering a dataset rather than
    crawling the catalogue is that a human has looked at it once and written
    down what its numbers mean.

    Two table shapes are supported. Long tables name one amount field and one
    fiscal-year field. Wide tables leave those unset and declare ``columns``
    instead.
    """

    resource_id: str
    title: str
    entity_type: str
    stage: str
    unit: Unit
    entity_field: str
    amount_field: str = ""
    fy_field: str | None = None
    is_cumulative: bool = False
    #: Wide tables only. When set, ``amount_field`` and ``fy_field`` are unused.
    columns: tuple[ColumnSpec, ...] = ()
    #: Wide tables only. Normalised row labels to keep. A national summary table
    #: holds receipts, deficits and ratios alongside the expenditure line, and
    #: ingesting all of them as if they were the same quantity would be wrong in
    #: several directions at once. Empty means every row.
    keep_rows: tuple[str, ...] = ()
    #: Normalised row labels to drop. Budget tables interleave per-scheme lines
    #: with the ministry's own "Total" line; taking both would double the
    #: ministry, which is the single most common way a budget dashboard ends up
    #: reporting twice the real number.
    drop_rows: tuple[str, ...] = ()
    #: Field the keep/drop test reads. Defaults to ``entity_field``, and differs
    #: when a table is filtered on one column and named by another: the ministry
    #: totals of a scheme-level table are the rows whose scheme is "Total".
    row_filter_field: str | None = None
    #: Fixed entity id, for a table whose rows are one known aggregate rather
    #: than a list of named organisations. Skips alias resolution, which has
    #: nothing to resolve.
    entity_id: str | None = None

    @property
    def is_wide(self) -> bool:
        return bool(self.columns)


#: The national aggregate's entity id, matching NATIONAL_ENTITY_ID in
#: packages/core. Written out rather than imported: this is Python and that is
#: TypeScript, and the pair is pinned by a test.
NATIONAL_ENTITY_ID = "india"


#: The four columns the Central Sector Schemes statement publishes, in the
#: layout it has used for years: last year's actual, this year's budget and
#: revised estimates, next year's budget estimate. Shared by the two datasets
#: that read that resource, so a republished table is one edit rather than two
#: that can drift apart.
#:
#: The column names are as the portal spells them, underscores and all. Note
#: that "revised_estimates2022_2023_total" has no underscore before the year
#: while its budget-estimate neighbour does; that is the portal's spelling, not
#: a typo here, and a tidied-up guess would silently match nothing.
_BUDGET_COLUMNS: tuple[ColumnSpec, ...] = (
    ColumnSpec(field="actuals_2021_2022_total", fy="FY2022", stage="EXPENDITURE"),
    ColumnSpec(field="budget_estimates_2022_2023_total", fy="FY2023", stage="BE"),
    ColumnSpec(field="revised_estimates2022_2023_total", fy="FY2023", stage="RE"),
    ColumnSpec(field="budget_estimates2023_2024_total", fy="FY2024", stage="BE"),
)


#: Registered resources. Adding one is a deliberate act: docs/03 requires a
#: licence note and an entry before any pipeline reads it.
DATASETS: dict[str, DatasetSpec] = {
    # Budget at a Glance, the one-page summary of the Union Budget, published by
    # the Ministry of Finance. Wide, and in the standard four-column layout that
    # every Budget at a Glance has used for years:
    #
    #     Actuals 2021-22 | Budget 2022-23 | Revised 2022-23 | Budget 2023-24
    #
    # which is how `_2022_2023_br` is read as that year's Budget Estimate. The
    # figures confirm it: 39,44,909 crore is the published 2022-23 BE for total
    # expenditure.
    #
    # Only the total expenditure line is taken. The same table carries receipts,
    # three deficits and their GDP ratios, and those are not expenditure however
    # much they look like comparable numbers.
    "budget_at_a_glance": DatasetSpec(
        resource_id="9f60de19-bf93-4ec9-83a4-2b0cf00479d1",
        title="Budget at a Glance, Union Budget 2021-22 to 2023-24",
        entity_type="national",
        entity_id=NATIONAL_ENTITY_ID,
        stage="BE",
        unit=CRORE,
        entity_field="si__no_________parameters",
        keep_rows=("9 total expenditure 10 13",),
        columns=(
            ColumnSpec(field="_2021_2022_actuals", fy="FY2022", stage="EXPENDITURE"),
            ColumnSpec(field="_2022_2023_br", fy="FY2023", stage="BE"),
            ColumnSpec(field="_2022_2023_re", fy="FY2023", stage="RE"),
            ColumnSpec(field="_2023_2024_be", fy="FY2024", stage="BE"),
        ),
    ),
    # Central Sector Schemes as laid before Parliament, one row per scheme with
    # its ministry, its demand number, and actuals, budget and revised estimates
    # across three years.
    #
    # The per-ministry "Total" rows are dropped rather than ingested: see the
    # note above for why they are not a ministry allocation, and taking them
    # alongside the scheme rows would in any case count every rupee twice.
    #
    # Only the ``_total`` columns are read. The revenue and capital splits are
    # also published, and the resource's own field list contains two columns
    # whose names differ by a single underscore, one of which is empty. Reading
    # only the totals sidesteps a naming collision that nothing in the response
    # explains.
    # NOT REGISTERED: the "Total" rows of the resource below, as a ministry
    # allocation.
    #
    # They look like exactly what a ministry page needs, and they are not. The
    # statement's Total for a ministry equals the sum of that ministry's scheme
    # rows *within this statement*, verified against the published data for all
    # 69 ministries in it, to the paisa. It is therefore the total of that
    # ministry's Central Sector Schemes, not its demand for grants. Publishing it
    # as the ministry's budget would understate every ministry, by an amount that
    # varies per ministry, and would make percent-spent meaningless against it.
    #
    # Ministry-level allocation comes from the Expenditure Budget instead, which
    # is a PDF on a portal that refuses automated clients. That is what the
    # intake path in data/intake exists for.
    "scheme_wise_budget": DatasetSpec(
        resource_id="38772e39-7774-4dca-b8d4-39aa40b60963",
        title="Central Sector Schemes, scheme level, Union Budget 2021-22 to 2023-24",
        entity_type="scheme",
        stage="BE",
        unit=CRORE,
        entity_field="scheme",
        row_filter_field="scheme",
        drop_rows=("total",),
        columns=_BUDGET_COLUMNS,
    ),
}


class OgdRecordRow(BaseModel):
    """One record from a registered OGD resource."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    dataset: str = Field(min_length=1)
    entity_raw: str = Field(min_length=1)
    entity_normalised: str = Field(min_length=1)
    fy: str = Field(pattern=r"^FY\d{4}$")
    stage: str
    amount_inr_cr: Decimal
    is_cumulative: bool = False
    updated_date: date | None = None


def parse_resource_payload(
    payload: str | bytes,
    spec: DatasetSpec,
    *,
    dataset_name: str,
    default_fy: str | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """Read an api.data.gov.in JSON response into rows.

    The API wraps records in ``{"records": [...], "field": [...]}``. The field
    list is captured as the column set so that a renamed field is caught by the
    drift check even when every record still validates.
    """
    try:
        document = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ValueError(f"OGD resource {spec.resource_id} did not return JSON: {exc}") from exc

    records = document.get("records") or []
    field_names = [
        str(item.get("id") or item.get("name"))
        for item in (document.get("field") or [])
        if item.get("id") or item.get("name")
    ]
    if not field_names and records:
        field_names = sorted(str(key) for key in records[0])

    updated = parse_iso_date(document.get("updated_date") or document.get("updated"))

    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    if spec.is_wide:
        wide_rows, wide_errors = _parse_wide_records(
            records, spec, dataset_name=dataset_name, updated=updated
        )
        return wide_rows, wide_errors, field_names

    for index, record in enumerate(records):
        entity = str(record.get(spec.entity_field, "")).strip()
        if not entity:
            errors.append(
                {
                    "reason": f"Record {index} has no {spec.entity_field}.",
                    "stage_hint": spec.stage,
                    "raw_context": {"record": record},
                }
            )
            continue

        fy_value = str(record.get(spec.fy_field, "")).strip() if spec.fy_field else ""
        fy = _resolve_fy(fy_value, default_fy)
        if fy is None:
            errors.append(
                {
                    "reason": f"Record {index} carries no readable fiscal year ({fy_value!r}).",
                    "stage_hint": spec.stage,
                    "raw_context": {"record": record},
                }
            )
            continue

        try:
            amount = parse_amount_cr(str(record.get(spec.amount_field, "")), unit_hint=spec.unit)
        except AmountParseError as exc:
            errors.append(
                {
                    "reason": str(exc),
                    "stage_hint": spec.stage,
                    "raw_context": {"record": record, "field": spec.amount_field},
                }
            )
            continue
        if not isinstance(amount, Decimal):
            continue

        rows.append(
            {
                "dataset": dataset_name,
                "entity_raw": entity,
                "entity_normalised": normalise_org_name(entity),
                "fy": fy,
                "stage": spec.stage,
                "amount_inr_cr": amount,
                "is_cumulative": spec.is_cumulative,
                "updated_date": updated,
            }
        )

    return rows, errors, field_names


def _parse_wide_records(
    records: list[Any],
    spec: DatasetSpec,
    *,
    dataset_name: str,
    updated: date | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """One row per (record, declared column) for a wide table.

    A declared column that is missing from the response is an error, not a
    skip. These tables are republished each February with the years shifted
    along, and a silently absent column would quietly stop ingesting a stage
    while the run still reported success.
    """
    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    wanted = set(spec.keep_rows)
    unwanted = set(spec.drop_rows)
    filter_field = spec.row_filter_field or spec.entity_field
    matched_any = False

    for index, record in enumerate(records):
        label = str(record.get(spec.entity_field, "")).strip()
        normalised = normalise_org_name(label)
        selector = (
            normalised
            if filter_field == spec.entity_field
            else normalise_org_name(str(record.get(filter_field, "")).strip())
        )
        if wanted and selector not in wanted:
            continue
        if selector in unwanted:
            continue
        if not label:
            continue
        matched_any = True

        for column in spec.columns:
            if column.field not in record:
                errors.append(
                    {
                        "reason": (
                            f"Declared column {column.field!r} is absent from the response. The "
                            f"table has been republished with different columns and the dataset "
                            f"registration needs revisiting."
                        ),
                        "stage_hint": column.stage,
                        "raw_context": {"record_index": index, "fields": sorted(record)},
                    }
                )
                continue
            try:
                amount = parse_amount_cr(str(record.get(column.field, "")), unit_hint=spec.unit)
            except AmountParseError as exc:
                errors.append(
                    {
                        "reason": str(exc),
                        "stage_hint": column.stage,
                        "raw_context": {"record": record, "field": column.field},
                    }
                )
                continue
            if not isinstance(amount, Decimal):
                continue
            rows.append(
                {
                    "dataset": dataset_name,
                    "entity_raw": label,
                    "entity_normalised": normalised,
                    "fy": column.fy,
                    "stage": column.stage,
                    "amount_inr_cr": amount,
                    "is_cumulative": column.is_cumulative,
                    "updated_date": updated,
                }
            )

    if wanted and not matched_any:
        # The row we came for is gone. Reported rather than returning an empty
        # result, which the drift check would otherwise have to guess at.
        errors.append(
            {
                "reason": (
                    f"None of the rows this dataset selects were found. Expected one of: "
                    f"{', '.join(sorted(wanted))}."
                ),
                "stage_hint": spec.stage,
                "raw_context": {
                    "labels_seen": [
                        str(record.get(spec.entity_field, "")) for record in records[:25]
                    ]
                },
            }
        )

    return rows, errors


def _resolve_fy(value: str, default_fy: str | None) -> str | None:
    if value:
        if is_fy(value):
            return value
        try:
            return fy_from_indian_label(value)
        except Exception:  # noqa: BLE001 - the field may hold something else entirely
            return default_fy
    return default_fy


def to_facts(
    rows: list[OgdRecordRow],
    spec: DatasetSpec,
    *,
    resolve_entity: dict[str, str] | None = None,
) -> tuple[list[FiscalFactRow], list[dict[str, Any]]]:
    aliases = resolve_entity or {}
    facts: list[FiscalFactRow] = []
    unresolved: list[dict[str, Any]] = []
    for row in rows:
        # A national aggregate is one known entity, not a name to look up. The
        # alias table has nothing to say about "Total Expenditure".
        entity_id = spec.entity_id or aliases.get(row.entity_normalised)
        if entity_id is None:
            unresolved.append(
                {
                    "reason": "No entity_alias maps this name to a stable id.",
                    "stage_hint": row.stage,
                    "raw_context": {"entity_raw": row.entity_raw, "dataset": row.dataset},
                }
            )
            continue
        period_end = None
        if row.stage not in {"BE", "RE", "SUPPLEMENTARY"}:
            from pipelines.parsers.fy_dates import fy_end

            period_end = fy_end(row.fy)
        facts.append(
            FiscalFactRow(
                fy=row.fy,
                entity_type=spec.entity_type,  # type: ignore[arg-type]
                entity_id=entity_id,
                stage=row.stage,  # type: ignore[arg-type]
                head="total",
                period_end=period_end,
                is_cumulative=row.is_cumulative,
                amount_inr_cr=row.amount_inr_cr,
                extraction_method="structured_api",
            )
        )
    return facts, unresolved


def resource_url(spec: DatasetSpec, settings: Settings, *, limit: int = 1000) -> str:
    if not spec.resource_id:
        raise ValueError(
            f"Dataset {spec.title!r} has no resource id yet. Fill it in from data.gov.in and "
            f"record the licence note in db/seed/02_source_registry.sql before enabling it."
        )
    if not settings.ogd_api_key:
        raise ValueError(
            "OGD_API_KEY is not set. The key is free from data.gov.in and using the API is "
            "preferred over scraping the same figures out of a PDF."
        )
    return (
        f"{URLS['resource'].format(resource_id=spec.resource_id)}"
        f"?api-key={settings.ogd_api_key}&format=json&limit={limit}"
    )


def run(
    *,
    dataset: str,
    conn: psycopg.Connection[dict[str, Any]] | None = None,
    client: PoliteClient | None = None,
    dry_run: bool = False,
    settings: Settings | None = None,
    default_fy: str | None = None,
    resolve_entity: dict[str, str] | None = None,
) -> RunOutcome:
    """Seven steps, in the order docs/02 section 5 fixes them."""
    spec = DATASETS.get(dataset)
    if spec is None:
        raise KeyError(f"Unregistered dataset {dataset!r}. Known: {', '.join(sorted(DATASETS))}")

    resolved_settings = settings or get_settings()
    outcome = RunOutcome(source_id=SOURCE_ID, status="ok")
    owns_client = client is None
    http = client or PoliteClient(resolved_settings)

    try:
        # Scoped to the dataset: this source serves several unrelated tables,
        # and comparing a four-row national summary against a 792-row scheme
        # statement produces findings that are arithmetically correct and
        # completely uninformative.
        with PipelineRun(SOURCE_ID, conn, dry_run=dry_run, variant=dataset) as run_ctx:
            ingested = ingest_url(
                resource_url(spec, resolved_settings),
                source_id=SOURCE_ID,
                client=http,
                run=run_ctx,
                conn=conn,
            )
            outcome.artifacts.append(ingested.artifact.key)

            rows, parse_errors, fields = parse_resource_payload(
                ingested.content, spec, dataset_name=dataset, default_fy=default_fy
            )

            validated = validate_rows(rows, OgdRecordRow, source_id=SOURCE_ID, allow_empty=True)
            outcome.rows_parsed = len(validated)
            outcome.parse_errors = len(parse_errors)

            metrics = RunMetrics(
                row_count=len(validated),
                total_amount_inr_cr=(
                    sum((row.amount_inr_cr for row in validated), Decimal(0)) if validated else None
                ),
                columns=tuple(fields),
                parse_error_count=len(parse_errors),
                extra={"dataset": dataset},
            )
            run_ctx.set_run_metrics(metrics)

            findings = sanity_check(metrics, run_ctx.baseline())
            outcome.drift = [finding.to_jsonable() for finding in findings]
            run_ctx.abort_if_drifted(findings)

            if resolve_entity is None:
                from pipelines.lib.db import load_alias_map

                resolve_entity = load_alias_map(conn, spec.entity_type)
            facts, unresolved = to_facts(validated, spec, resolve_entity=resolve_entity)
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
