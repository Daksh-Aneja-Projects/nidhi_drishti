"""Government e-Marketplace (gem.gov.in) published statistics.

Aggregates only. docs/03 section 2.2 keeps this at the level GeM itself
publishes: gross merchandise value, order counts, and buyer-organisation splits.
Item-level purchase data is not collected even where it is technically visible,
and beneficiary-level data never is (docs/08 section 4).

The published figures are cumulative for the financial year. Two snapshots a
week apart are two views of the same running total, so they are stored as
cumulative facts and never added together.
"""

from __future__ import annotations

import json
import re
from datetime import date
from decimal import Decimal
from typing import Any

import psycopg
import structlog
from pydantic import BaseModel, ConfigDict, Field

from pipelines.lib.drift import RunMetrics, sanity_check
from pipelines.lib.fetch import PoliteClient
from pipelines.lib.ingest import ingest_url
from pipelines.lib.runs import PipelineRun
from pipelines.lib.validation import validate_rows
from pipelines.parsers.fy_dates import fy_of
from pipelines.parsers.inr_amounts import (
    AmountParseError,
    Unit,
    parse_amount_cr,
    parse_unit_hint,
)
from pipelines.parsers.text_norm import clean_cell, normalise_org_name
from pipelines.sources._common import RunOutcome, soup_of, table_rows

log = structlog.get_logger(__name__)

SOURCE_ID = "gem"

URLS: dict[str, str] = {
    "home": "https://gem.gov.in/",
    "statistics": "https://gem.gov.in/statistics",
    # Some of the dashboard tiles are backed by a public JSON endpoint. When it
    # is reachable it is preferred: parsing a number out of rendered HTML is a
    # last resort.
    "statistics_json": "https://gem.gov.in/api/statistics",
}

#: Metric labels the statistics page uses, mapped to our field names. Matching
#: on the label rather than on tile position survives a redesign.
METRIC_LABELS: dict[str, tuple[str, ...]] = {
    "gross_merchandise_value": ("gmv", "gross merchandise value", "order value", "total value"),
    "order_count": ("orders", "total orders", "order count"),
    "seller_count": ("sellers", "total sellers", "sellers and service providers"),
    "buyer_count": ("buyers", "total buyers", "buyer organisations"),
}


class GemStatRow(BaseModel):
    """One published GeM aggregate."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    metric: str = Field(min_length=2)
    label_raw: str = Field(min_length=1)
    #: Present only for value metrics. Counts are held in ``count`` instead,
    #: because an order count is not money and must never reach a money column.
    value_inr_cr: Decimal | None = None
    count: int | None = None
    organisation_raw: str | None = None
    organisation_normalised: str | None = None
    as_of: date
    fy: str = Field(pattern=r"^FY\d{4}$")
    is_cumulative: bool = True


def parse_statistics_json(
    payload: str | bytes,
    *,
    as_of: date,
    unit_hint: Unit | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """Read the statistics endpoint when it is available."""
    try:
        document = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ValueError(f"GeM statistics endpoint did not return JSON: {exc}") from exc

    flat = document.get("data", document) if isinstance(document, dict) else {}
    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    fields = sorted(str(key) for key in flat) if isinstance(flat, dict) else []

    for metric, aliases in METRIC_LABELS.items():
        raw_key = next(
            (key for key in fields if any(alias in str(key).lower() for alias in aliases)), None
        )
        if raw_key is None:
            continue
        raw_value = flat[raw_key]
        row = _build_row(metric, str(raw_key), raw_value, as_of, unit_hint, errors)
        if row is not None:
            rows.append(row)

    return rows, errors, fields


def parse_statistics_page(
    markup: str,
    *,
    as_of: date,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """Read the rendered statistics page as a fallback.

    The unit is taken from the page text, where GeM writes "in crore" beside the
    figure. Without it the value is queued rather than assumed.
    """
    document = soup_of(markup)
    text = document.get_text(" ", strip=True)
    unit = parse_unit_hint(text[:3000])

    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    labels: list[str] = []

    for table in document.find_all("table"):
        for record in table_rows(table)[1:]:
            if len(record) < 2:
                continue
            label = clean_cell(record[0])
            labels.append(label)
            metric = _metric_for(label)
            if metric is None:
                continue
            row = _build_row(metric, label, clean_cell(record[1]), as_of, unit, errors)
            if row is not None:
                rows.append(row)

    # Dashboard tiles: a label element next to a value element.
    for tile in document.select("[class*=stat], [class*=tile], [class*=card]"):
        tile_text = clean_cell(tile.get_text(" ", strip=True))
        if not tile_text or len(tile_text) > 120:
            continue
        metric = _metric_for(tile_text)
        if metric is None:
            continue
        match = re.search(r"[\d,]+(?:\.\d+)?\s*(?:lakh crore|crore|cr|lakh)?", tile_text)
        if not match:
            continue
        labels.append(tile_text)
        row = _build_row(metric, tile_text, match.group(0), as_of, unit, errors)
        if row is not None:
            rows.append(row)

    deduped: dict[str, dict[str, Any]] = {}
    for row in rows:
        deduped.setdefault(str(row["metric"]), row)
    return list(deduped.values()), errors, labels


def _metric_for(label: str) -> str | None:
    lowered = label.lower()
    for metric, aliases in METRIC_LABELS.items():
        if any(alias in lowered for alias in aliases):
            return metric
    return None


def _build_row(
    metric: str,
    label: str,
    raw_value: Any,
    as_of: date,
    unit: Unit | None,
    errors: list[dict[str, Any]],
) -> dict[str, Any] | None:
    is_money = metric == "gross_merchandise_value"
    if is_money:
        try:
            amount = parse_amount_cr(str(raw_value), unit_hint=unit)
        except AmountParseError as exc:
            errors.append(
                {
                    "reason": str(exc),
                    "stage_hint": metric,
                    "raw_context": {"label": label, "value": str(raw_value)},
                }
            )
            return None
        if not isinstance(amount, Decimal):
            return None
        return {
            "metric": metric,
            "label_raw": label,
            "value_inr_cr": amount,
            "count": None,
            "organisation_raw": None,
            "organisation_normalised": None,
            "as_of": as_of,
            "fy": fy_of(as_of),
            "is_cumulative": True,
        }

    digits = re.sub(r"[^\d]", "", str(raw_value))
    if not digits:
        return None
    return {
        "metric": metric,
        "label_raw": label,
        "value_inr_cr": None,
        "count": int(digits),
        "organisation_raw": None,
        "organisation_normalised": None,
        "as_of": as_of,
        "fy": fy_of(as_of),
        "is_cumulative": True,
    }


def normalise_organisation(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Attach a normalised organisation name where one is present."""
    for row in rows:
        raw = row.get("organisation_raw")
        if raw:
            row["organisation_normalised"] = normalise_org_name(str(raw))
    return rows


def run(
    *,
    as_of: date,
    conn: psycopg.Connection[dict[str, Any]] | None = None,
    client: PoliteClient | None = None,
    dry_run: bool = False,
    url: str | None = None,
) -> RunOutcome:
    """Seven steps, in the order docs/02 section 5 fixes them.

    Nothing here writes a fiscal fact. GeM aggregates are a procurement activity
    signal recorded in run metrics and the verification layer; treating a
    marketplace total as government expenditure would double count every rupee
    that CGA already reports.
    """
    outcome = RunOutcome(source_id=SOURCE_ID, status="ok")
    owns_client = client is None
    http = client or PoliteClient()

    try:
        with PipelineRun(SOURCE_ID, conn, dry_run=dry_run) as run_ctx:
            target = url or URLS["statistics"]
            ingested = ingest_url(
                target,
                source_id=SOURCE_ID,
                client=http,
                run=run_ctx,
                conn=conn,
                document_date=as_of,
            )
            outcome.artifacts.append(ingested.artifact.key)

            if "json" in ingested.fetch.content_type:
                rows, parse_errors, columns = parse_statistics_json(
                    ingested.content, as_of=as_of
                )
            else:
                rows, parse_errors, columns = parse_statistics_page(ingested.text, as_of=as_of)

            validated = validate_rows(rows, GemStatRow, source_id=SOURCE_ID, allow_empty=True)
            outcome.rows_parsed = len(validated)
            outcome.parse_errors = len(parse_errors)

            values = [row.value_inr_cr for row in validated if row.value_inr_cr is not None]
            metrics = RunMetrics(
                row_count=len(validated),
                total_amount_inr_cr=sum(values, Decimal(0)) if values else None,
                columns=tuple(columns[:50]),
                parse_error_count=len(parse_errors),
                extra={"as_of": as_of.isoformat()},
            )
            run_ctx.set_run_metrics(metrics)

            findings = sanity_check(metrics, run_ctx.baseline())
            outcome.drift = [finding.to_jsonable() for finding in findings]
            run_ctx.abort_if_drifted(findings)

            outcome.notes.append(
                "GeM aggregates are recorded as a procurement activity signal, not as "
                "expenditure."
            )
            run_ctx.metric(metrics_captured=len(validated))
            outcome.status = "drift_alert" if findings else "ok"
    finally:
        if owns_client:
            http.close()

    return outcome
