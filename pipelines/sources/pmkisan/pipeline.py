"""PM-KISAN dashboard (pmkisan.gov.in).

PM-KISAN publishes a public dashboard of beneficiary and payment figures. This
module extracts **aggregate national figures only**, and that limit is enforced
in code rather than trusted to the author.

Why the hard limit: docs/08 section 4 forbids ingesting beneficiary-level DBT
data even where it is technically visible on the portal. A dashboard that shows
per-farmer registration numbers, names, villages, or account details is a
privacy boundary, and "we only meant to read the totals" is not a defence once
the row-level data is in our store. So this parser works from a whitelist of
aggregate labels and actively refuses any table that looks beneficiary-level
(see :func:`is_beneficiary_level`). It cannot capture a per-beneficiary row even
if the portal starts serving one on a page we already read.

Fiscal-stage mapping: PM-KISAN is a direct benefit transfer. The published
"funds transferred" figure is money leaving the Union to reach the beneficiary,
so it maps to the **RELEASE** stage (docs/04: "money leaves"). It is deliberately
*not* recorded as UTILIZATION: a DBT has no separate implementing-agency spend
step to observe, and the per-beneficiary transfers that would evidence
utilization are exactly the data we are forbidden to ingest. The aggregate
beneficiary *count* is not money and is kept in run metrics only, never written
to a fiscal-fact amount column.

The figure is cumulative for the financial year, so it is stored with
``is_cumulative = true`` and is never summed across snapshots.
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

SOURCE_ID = "pmkisan"

#: The scheme every figure from this portal belongs to. It already exists in
#: db/seed/04_schemes.sql; this module never invents a scheme id.
SCHEME_ID = "sch-pm-kisan"

#: Every entry point for this source, in one place. Not verified live. A 404
#: surfaces as a failed run with an alert; a served-but-restructured page parses
#: to zero rows which the drift check turns into a high-severity finding. The
#: fix is always a one-place edit here.
URLS: dict[str, str] = {
    "home": "https://pmkisan.gov.in/",
    "dashboard": "https://pmkisan.gov.in/Dashboard.aspx",
}

Stage = Literal["RELEASE"]

#: Aggregate money labels we accept, mapped to the fiscal stage they represent.
#: A whitelist rather than a blocklist: only these labels produce a money fact,
#: so a new row on the dashboard is ignored by default rather than ingested by
#: accident.
MONEY_LABELS: dict[Stage, tuple[str, ...]] = {
    "RELEASE": (
        "total funds transferred",
        "funds transferred",
        "total amount released",
        "amount disbursed",
        "total benefit released",
    ),
}

#: Aggregate count labels. These are not money and are kept in run metrics only.
COUNT_LABELS: tuple[str, ...] = (
    "total beneficiaries",
    "beneficiaries covered",
    "registered beneficiaries",
    "total farmers",
    "farmers benefited",
)

#: Header or cell fragments that mark a table as beneficiary-level. Any table
#: whose header contains one of these is refused outright: it is the row-level
#: data docs/08 section 4 forbids, and we do not read it even to reach a total.
BENEFICIARY_LEVEL_MARKERS: tuple[str, ...] = (
    "registration",
    "reg no",
    "reg. no",
    "aadhaar",
    "aadhar",
    "account no",
    "account number",
    "bank account",
    "ifsc",
    "beneficiary name",
    "farmer name",
    "beneficiary id",
    "mobile",
    "village",
    "father",
)

_INDIAN_FY = re.compile(r"\b(\d{4}\s*[-/]\s*\d{2,4})\b")
_COUNT_DIGITS = re.compile(r"[\d,]{2,}")
#: A money value: an optional currency marker, a number, and an optional unit.
#: Used only on the text that *follows* a matched money label, so an unrelated
#: number elsewhere in the same element cannot be picked up as the amount.
_VALUE_PHRASE = re.compile(
    r"(?:₹|Rs\.?|INR)?\s*[\d,]+(?:\.\d+)?\s*"
    r"(?:lakh\s+crore|thousand\s+crore|crore|cr\.?|lakh)?",
    re.IGNORECASE,
)


class PmKisanAggregateRow(BaseModel):
    """One aggregate money figure as published on the dashboard.

    There is no beneficiary identifier field on this schema, by design: the row
    shape itself cannot carry per-beneficiary data into the canonical store.
    """

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


def is_beneficiary_level(cells: list[str]) -> bool:
    """True when a set of header cells describes beneficiary-level data.

    The gate that makes docs/08 section 4 mechanical: a table matching this is
    never read, so no per-farmer row can enter the pipeline regardless of what
    the portal chooses to serve.
    """
    haystack = " ".join(cell.lower() for cell in cells)
    return any(marker in haystack for marker in BENEFICIARY_LEVEL_MARKERS)


def _money_stage(label: str) -> Stage | None:
    lowered = label.lower()
    for stage, aliases in MONEY_LABELS.items():
        if any(alias in lowered for alias in aliases):
            return stage
    return None


def _is_count_label(label: str) -> bool:
    lowered = label.lower()
    return any(alias in lowered for alias in COUNT_LABELS)


def _value_after_alias(text: str, aliases: tuple[str, ...]) -> str | None:
    """The money value that appears *after* a matched label in ``text``.

    A dashboard tile puts the label and its number in one string, and a parent
    container can concatenate several tiles. Reading the number that follows the
    label, rather than the first number anywhere in the element, is what stops a
    beneficiary *count* sitting next to the label from being mistaken for the
    amount transferred.
    """
    lowered = text.lower()
    end = -1
    for alias in aliases:
        index = lowered.find(alias)
        if index != -1:
            end = max(end, index + len(alias))
    if end == -1:
        return None
    match = _VALUE_PHRASE.search(text[end:])
    if not match:
        return None
    candidate = match.group(0).strip()
    return candidate or None


def parse_dashboard(
    markup: str,
    *,
    as_of: date,
    fy: str | None = None,
    unit_hint: Unit | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """Parse the aggregate dashboard.

    Returns ``(money_rows, count_aggregates, parse_errors, labels_seen)``. Money
    rows become RELEASE facts; count aggregates are national totals kept in run
    metrics only. Beneficiary-level tables are skipped before a single cell is
    read.
    """
    document = soup_of(markup)
    page_text = document.get_text(" ", strip=True)
    resolved_fy = fy or _fy_from_text(page_text) or fy_of(as_of)
    unit = unit_hint or parse_unit_hint(page_text[:3000])

    money_rows: list[dict[str, Any]] = []
    counts: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    labels: list[str] = []

    # Aggregate summary tables. A table that looks beneficiary-level is refused
    # in full: docs/08 section 4 does not permit reading it even to reach a
    # total.
    for table in document.find_all("table"):
        candidate = table_rows(table)
        if not candidate:
            continue
        if is_beneficiary_level(candidate[0]):
            log.info("pmkisan.beneficiary_table_refused", columns=candidate[0])
            continue
        for record in candidate[1:]:
            if len(record) < 2 or is_beneficiary_level(record):
                continue
            label = clean_cell(record[0])
            value = clean_cell(record[1])
            _absorb(label, value, as_of, resolved_fy, unit, money_rows, counts, errors, labels)

    # Dashboard tiles: a label and a value in one small element, the common
    # shape of the PM-KISAN landing page.
    for tile in document.select("[class*=stat], [class*=tile], [class*=card], [class*=count]"):
        tile_text = clean_cell(tile.get_text(" ", strip=True))
        if not tile_text or len(tile_text) > 160:
            continue
        _absorb_tile(tile_text, as_of, resolved_fy, unit, money_rows, counts, errors, labels)

    # A dashboard can repeat the same tile in a table and a card. Keep the first
    # of each stage, since both are the same running total.
    deduped: dict[str, dict[str, Any]] = {}
    for row in money_rows:
        deduped.setdefault(str(row["stage"]), row)
    return list(deduped.values()), counts, errors, labels


def _absorb(
    label: str,
    value: str,
    as_of: date,
    fy: str,
    unit: Unit | None,
    money_rows: list[dict[str, Any]],
    counts: list[dict[str, Any]],
    errors: list[dict[str, Any]],
    labels: list[str],
) -> None:
    """Classify one label/value pair from a summary table."""
    labels.append(label)
    stage = _money_stage(label)
    if stage is not None:
        try:
            amount = parse_amount_cr(value, unit_hint=unit)
        except AmountParseError as exc:
            errors.append(
                {
                    "reason": str(exc),
                    "stage_hint": stage,
                    "raw_context": {"label": label, "value": value},
                }
            )
            return
        if isinstance(amount, Decimal):
            money_rows.append(
                {
                    "stage": stage,
                    "label_raw": label,
                    "fy": fy,
                    "amount_inr_cr": amount,
                    "as_of": as_of,
                    "is_cumulative": True,
                }
            )
        return
    if _is_count_label(label):
        count = _read_count(value)
        if count is not None:
            counts.append({"label": label, "count": count})


def _absorb_tile(
    tile_text: str,
    as_of: date,
    fy: str,
    unit: Unit | None,
    money_rows: list[dict[str, Any]],
    counts: list[dict[str, Any]],
    errors: list[dict[str, Any]],
    labels: list[str],
) -> None:
    """Classify one dashboard tile, where label and value share the text."""
    stage = _money_stage(tile_text)
    if stage is not None:
        candidate = _value_after_alias(tile_text, MONEY_LABELS[stage])
        if candidate is None:
            return
        labels.append(tile_text)
        try:
            amount = parse_amount_cr(candidate, unit_hint=unit)
        except AmountParseError as exc:
            errors.append(
                {
                    "reason": str(exc),
                    "stage_hint": stage,
                    "raw_context": {"tile": tile_text, "value": candidate},
                }
            )
            return
        if isinstance(amount, Decimal):
            money_rows.append(
                {
                    "stage": stage,
                    "label_raw": tile_text,
                    "fy": fy,
                    "amount_inr_cr": amount,
                    "as_of": as_of,
                    "is_cumulative": True,
                }
            )
        return
    if _is_count_label(tile_text):
        count = _read_count(tile_text)
        if count is not None:
            labels.append(tile_text)
            counts.append({"label": tile_text, "count": count})


def _read_count(text: str) -> int | None:
    """Read an integer count from a cell or tile.

    A count is not money, so it never touches :func:`parse_amount_cr` and can
    never end up in an amount column. The largest digit group in the text is
    taken, which is the count itself rather than a fiscal-year fragment.
    """
    groups = _COUNT_DIGITS.findall(text)
    if not groups:
        return None
    digits = max((group.replace(",", "") for group in groups), key=len)
    return int(digits) if digits.isdigit() else None


def to_facts(rows: list[PmKisanAggregateRow]) -> list[FiscalFactRow]:
    """Map validated aggregate rows to RELEASE facts for PM-KISAN.

    Only the aggregate disbursement is written, and only as RELEASE. The
    per-beneficiary transfers behind it are never here to map, because
    :func:`parse_dashboard` never read them.
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

            money_rows, counts, parse_errors, labels = parse_dashboard(
                ingested.text, as_of=snapshot_date, fy=fy
            )

            validated = validate_rows(
                money_rows, PmKisanAggregateRow, source_id=SOURCE_ID, allow_empty=True
            )
            outcome.rows_parsed = len(validated)
            outcome.parse_errors = len(parse_errors)

            metrics = RunMetrics(
                row_count=len(validated),
                total_amount_inr_cr=(
                    sum((row.amount_inr_cr for row in validated), Decimal(0)) if validated else None
                ),
                columns=tuple(labels[:50]),
                parse_error_count=len(parse_errors),
                extra={
                    "as_of": snapshot_date.isoformat(),
                    # Aggregate counts are recorded for the ops page, never as a
                    # money fact.
                    "aggregate_counts": counts,
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
                "Aggregate figures only. Beneficiary-level data is never ingested (docs/08 "
                "section 4). Funds transferred is recorded as RELEASE, the direct benefit "
                "transfer disbursement stage."
            )
            run_ctx.metric(facts_written=outcome.facts_written, aggregate_counts=len(counts))

        outcome.status = run_ctx.status
    finally:
        if owns_client:
            http.close()

    return outcome
