"""Central Public Procurement Portal (eprocure.gov.in) tender notices.

Tier 2 evidence. Tenders answer "is the money turning into observable activity",
which is a weaker and different question from "how much was spent", and nothing
from this module ever becomes a fiscal figure on a chart.

Access posture, from docs/08 section 1, is strict here because CPPP is the
source most likely to tempt otherwise:

* only the public listing pages the portal serves to any anonymous visitor;
* no CAPTCHA flow is ever touched, so tender coverage is partial **by design**
  and the product says so rather than implying completeness;
* one request every two seconds, daily, off peak.

Organisation naming on CPPP is inconsistent to the point of being its own
project, so every tender carries ``match_confidence`` and an unmatched tender is
kept with a null ministry rather than being attached to a plausible one.
"""

from __future__ import annotations

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
from pipelines.lib.models import TenderRow
from pipelines.lib.runs import PipelineRun
from pipelines.lib.validation import validate_rows
from pipelines.parsers.inr_amounts import (
    RUPEE,
    AmountParseError,
    parse_amount_cr,
)
from pipelines.parsers.text_norm import best_matches, clean_cell, normalise_org_name
from pipelines.sources._common import RunOutcome, parse_iso_date, soup_of, table_rows

log = structlog.get_logger(__name__)

SOURCE_ID = "cppp"

URLS: dict[str, str] = {
    # Public listing of latest active tenders. No login, no CAPTCHA on this view.
    "latest_tenders": "https://eprocure.gov.in/eprocure/app?page=FrontEndLatestActiveTenders&service=page",
    # Awards of contract, the more useful half for verification.
    "awards": "https://eprocure.gov.in/epublish/app?page=FrontEndListTendersbyDate&service=page",
    "home": "https://eprocure.gov.in/eprocure/app",
}

#: Header words that identify the tender listing table.
LISTING_HEADERS = ("tender", "organisation")
LISTING_HEADERS_ALT = ("tender", "organization")

#: CPPP publishes tender values in rupees, not crore. Getting this wrong by a
#: factor of ten million is the most obvious available mistake, so the unit is
#: stated here once and never inferred per row.
CPPP_VALUE_UNIT = RUPEE

_REFERENCE_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9/_.-]{5,}")


class CpppTenderRow(BaseModel):
    """One tender notice as the public listing publishes it."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    tender_id: str = Field(min_length=3)
    title: str = Field(min_length=3)
    org_raw: str = Field(min_length=2)
    org_normalised: str = Field(min_length=2)
    value_inr_cr: Decimal | None = None
    published_date: date | None = None
    closing_date: date | None = None
    url: str | None = None


def parse_tender_listing(
    markup: str,
    *,
    base_url: str = "https://eprocure.gov.in",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """Parse the public tender listing table.

    Columns are located by header text rather than by index, so a portal that
    adds a "corrigendum" column produces a drift finding instead of silently
    shifting every value one place to the left.
    """
    document = soup_of(markup)
    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    columns: list[str] = []

    listing: list[list[str]] = []
    for table in document.find_all("table"):
        candidate = table_rows(table)
        if not candidate:
            continue
        header = " ".join(candidate[0]).lower()
        if all(word in header for word in LISTING_HEADERS) or all(
            word in header for word in LISTING_HEADERS_ALT
        ):
            listing = candidate
            columns = [clean_cell(cell) for cell in candidate[0]]
            break

    if not listing:
        log.warning("cppp.listing_table_not_found")
        return rows, errors, columns

    index_of = _column_indices(columns)
    links = _row_links(document)

    for line, record in enumerate(listing[1:], start=1):
        title = _cell(record, index_of.get("title"))
        org = _cell(record, index_of.get("org"))
        reference = _cell(record, index_of.get("reference")) or _derive_reference(title, org, line)
        if not title or not org:
            continue

        value_cell = _cell(record, index_of.get("value"))
        value: Decimal | None = None
        if value_cell:
            try:
                parsed = parse_amount_cr(value_cell, unit_hint=CPPP_VALUE_UNIT)
                value = parsed if isinstance(parsed, Decimal) else None
            except AmountParseError as exc:
                # A tender with an unreadable value is still evidence that a
                # procurement happened, so the row is kept and only the amount
                # is queued.
                errors.append(
                    {
                        "reason": str(exc),
                        "stage_hint": "tender_value",
                        "raw_context": {"reference": reference, "cell": value_cell},
                    }
                )

        href = links.get(reference) or links.get(title)
        rows.append(
            {
                "tender_id": reference,
                "title": title,
                "org_raw": org,
                "org_normalised": normalise_org_name(org),
                "value_inr_cr": value,
                "published_date": parse_iso_date(_cell(record, index_of.get("published"))),
                "closing_date": parse_iso_date(_cell(record, index_of.get("closing"))),
                "url": f"{base_url}{href}" if href and href.startswith("/") else href,
            }
        )

    return rows, errors, columns


def _column_indices(columns: list[str]) -> dict[str, int]:
    wanted = {
        "reference": ("reference", "ref no", "tender id", "tender reference"),
        "title": ("title", "work description", "tender title"),
        "org": ("organisation", "organization", "department", "ministry"),
        "value": ("value", "tender value", "estimated cost", "amount"),
        "published": ("published", "publish date", "epublished"),
        "closing": ("closing", "bid submission", "closing date"),
    }
    found: dict[str, int] = {}
    for index, column in enumerate(columns):
        text = column.lower()
        for key, markers in wanted.items():
            if key not in found and any(marker in text for marker in markers):
                found[key] = index
    return found


def _cell(record: list[str], index: int | None) -> str:
    if index is None or index >= len(record):
        return ""
    return clean_cell(record[index])


def _row_links(document: Any) -> dict[str, str]:
    links: dict[str, str] = {}
    for anchor in document.find_all("a", href=True):
        text = clean_cell(anchor.get_text(" ", strip=True))
        if text:
            links.setdefault(text, str(anchor["href"]).strip())
    return links


def _derive_reference(title: str, org: str, line: int) -> str:
    """Build a stable id when the listing omits the reference number.

    Deterministic so that re-running the pipeline updates the same tender rather
    than creating a second copy of it every day.
    """
    match = _REFERENCE_PATTERN.search(title)
    if match:
        return match.group(0)[:120]
    import hashlib

    digest = hashlib.sha256(f"{org}|{title}".encode()).hexdigest()[:16]
    return f"cppp-derived-{digest}-{line}"


def match_organisation(
    org_normalised: str,
    ministries: dict[str, str],
) -> tuple[str | None, str | None]:
    """Resolve an organisation string to a ministry id, honestly.

    Returns ``(ministry_id, confidence)``. An exact normalised match is 'high'.
    A strong token overlap is 'medium' and is still shown, labelled. Anything
    weaker returns ``(None, None)``: an unattached tender is a gap, but a tender
    attached to the wrong ministry is a false claim about where money went.
    """
    exact = ministries.get(org_normalised)
    if exact:
        return exact, "high"

    candidates = [(entity_id, name) for name, entity_id in ministries.items()]
    ranked = best_matches(org_normalised, candidates, limit=1, minimum=0.6)
    if ranked:
        return ranked[0][0], "medium"
    return None, None


def to_tenders(
    rows: list[CpppTenderRow],
    *,
    ministries: dict[str, str] | None = None,
) -> list[TenderRow]:
    lookup = ministries or {}
    tenders: list[TenderRow] = []
    for row in rows:
        ministry_id, confidence = match_organisation(row.org_normalised, lookup)
        tenders.append(
            TenderRow(
                tender_id=row.tender_id,
                title=row.title,
                org_raw=row.org_raw,
                ministry_id=ministry_id,
                value_inr_cr=row.value_inr_cr,
                status="published",
                published_date=row.published_date,
                url=row.url,
                match_confidence=confidence,  # type: ignore[arg-type]
            )
        )
    return tenders


def run(
    *,
    conn: psycopg.Connection[dict[str, Any]] | None = None,
    client: PoliteClient | None = None,
    dry_run: bool = False,
    url: str | None = None,
    ministries: dict[str, str] | None = None,
) -> RunOutcome:
    """Seven steps, in the order docs/02 section 5 fixes them."""
    outcome = RunOutcome(source_id=SOURCE_ID, status="ok")
    owns_client = client is None
    http = client or PoliteClient()

    try:
        with PipelineRun(SOURCE_ID, conn, dry_run=dry_run) as run_ctx:
            ingested = ingest_url(
                url or URLS["latest_tenders"],
                source_id=SOURCE_ID,
                client=http,
                run=run_ctx,
                conn=conn,
            )
            outcome.artifacts.append(ingested.artifact.key)

            rows, parse_errors, columns = parse_tender_listing(ingested.text)

            validated = validate_rows(rows, CpppTenderRow, source_id=SOURCE_ID, allow_empty=True)
            outcome.rows_parsed = len(validated)
            outcome.parse_errors = len(parse_errors)

            values = [row.value_inr_cr for row in validated if row.value_inr_cr is not None]
            metrics = RunMetrics(
                row_count=len(validated),
                total_amount_inr_cr=sum(values, Decimal(0)) if values else None,
                columns=tuple(columns),
                parse_error_count=len(parse_errors),
                extra={"with_value": len(values)},
            )
            run_ctx.set_run_metrics(metrics)

            findings = sanity_check(metrics, run_ctx.baseline())
            outcome.drift = [finding.to_jsonable() for finding in findings]
            run_ctx.abort_if_drifted(findings)

            tenders = to_tenders(validated, ministries=ministries)
            if conn is not None and not run_ctx.dry_run and ingested.source_record_id is not None:
                from pipelines.lib.db import record_parse_errors, upsert_tenders

                outcome.facts_written = upsert_tenders(
                    conn, tenders, source_record_id=ingested.source_record_id
                )
                record_parse_errors(
                    conn,
                    parse_errors,
                    source_record_id=ingested.source_record_id,
                    pipeline_run_id=run_ctx.run_id,
                )
            else:
                outcome.notes.append("dry run: nothing written")

            unmatched = sum(1 for tender in tenders if tender.ministry_id is None)
            run_ctx.metric(tenders_written=outcome.facts_written, unmatched_org=unmatched)
            outcome.notes.append(
                f"{unmatched} of {len(tenders)} tenders could not be attached to a ministry and "
                f"are kept unattached rather than guessed at."
            )

        # Status comes from the run context, which has just written the
        # pipeline_run row. Informational findings are recorded; only warn and
        # high make a run a drift alert.
        outcome.status = run_ctx.status
    finally:
        if owns_client:
            http.close()

    return outcome
