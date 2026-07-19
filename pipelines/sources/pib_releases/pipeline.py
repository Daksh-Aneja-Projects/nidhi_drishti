"""Press Information Bureau releases (pib.gov.in).

Ministry press releases, ingested daily and tagged by ministry. They are the
citable record of what the government says it did and when, which is what turns
a verification narrative from an assertion into a footnoted paragraph.

Strictly Tier 2. A press release saying "₹5,000 crore released" is evidence of
an announcement, not a fiscal fact, and nothing here writes to ``fiscal_fact``.
Any figure found in a release is kept as text on the evidence row so an agent
can quote it with attribution, never as a number on a chart.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any

import psycopg
import structlog
from pydantic import BaseModel, ConfigDict, Field

from pipelines.lib.drift import RunMetrics, sanity_check
from pipelines.lib.fetch import PoliteClient
from pipelines.lib.ingest import ingest_url
from pipelines.lib.models import EvidenceRow
from pipelines.lib.runs import PipelineRun
from pipelines.lib.validation import validate_rows
from pipelines.parsers.text_norm import clean_cell, normalise_org_name
from pipelines.sources._common import RunOutcome, parse_iso_date, soup_of

log = structlog.get_logger(__name__)

SOURCE_ID = "pib"

URLS: dict[str, str] = {
    "home": "https://pib.gov.in/",
    # All-ministry release listing for a day. The portal has moved this path
    # before; a 404 here is a drift alert, not a crash.
    "all_releases": "https://pib.gov.in/allRel.aspx",
    "release": "https://pib.gov.in/PressReleasePage.aspx?PRID={prid}",
    "rss": "https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3",
}

#: Amount-shaped strings in release text. Captured as quotable text only.
_AMOUNT_IN_TEXT = re.compile(
    r"(?:₹|Rs\.?|INR)\s*[\d,]+(?:\.\d+)?\s*(?:lakh\s+crore|thousand\s+crore|crore|lakh|cr)\b",
    re.IGNORECASE,
)
_PRID = re.compile(r"PRID=(\d+)", re.IGNORECASE)


class PibReleaseRow(BaseModel):
    """One press release listing entry."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    prid: str = Field(min_length=1)
    title: str = Field(min_length=5)
    url: str = Field(min_length=10)
    ministry_raw: str | None = None
    ministry_normalised: str | None = None
    published_date: date | None = None
    #: Amount-shaped phrases found in the title, kept verbatim. These are quoted
    #: with attribution in narratives and never parsed into a fiscal figure.
    amount_mentions: tuple[str, ...] = ()


def parse_release_listing(
    markup: str,
    *,
    listing_date: date | None = None,
    base_url: str = "https://pib.gov.in",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """Parse the daily all-ministry release listing.

    The page groups releases under ministry headings, so the current heading is
    carried down the document. A release whose ministry heading cannot be
    determined keeps a null ministry: an unattributed release is honest, a
    misattributed one is not.
    """
    document = soup_of(markup)
    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    seen: set[str] = set()
    current_ministry: str | None = None

    for element in document.find_all(["h1", "h2", "h3", "h4", "a", "li", "div"]):
        name = element.name.lower()
        if name in {"h1", "h2", "h3", "h4"}:
            heading = clean_cell(element.get_text(" ", strip=True))
            if heading and len(heading) < 160:
                current_ministry = heading
            continue
        if name != "a":
            continue

        href = str(element.get("href") or "").strip()
        title = clean_cell(element.get_text(" ", strip=True))
        if not href or len(title) < 5:
            continue
        match = _PRID.search(href)
        if not match:
            continue
        prid = match.group(1)
        if prid in seen:
            continue
        seen.add(prid)

        ministry = current_ministry
        rows.append(
            {
                "prid": prid,
                "title": title,
                "url": href if href.startswith("http") else f"{base_url}/{href.lstrip('/')}",
                "ministry_raw": ministry,
                "ministry_normalised": normalise_org_name(ministry) if ministry else None,
                "published_date": listing_date or _date_near(element),
                "amount_mentions": tuple(_AMOUNT_IN_TEXT.findall(title)),
            }
        )

    if not rows:
        log.warning("pib.no_releases_found")
        errors.append(
            {
                "reason": "No press release links were found on the listing page. The PIB "
                "listing has moved or changed structure.",
                "stage_hint": "pib",
                "raw_context": {"length": len(markup)},
            }
        )

    return rows, errors, ["prid", "title", "ministry", "published_date"]


def _date_near(element: Any) -> date | None:
    """Look for a date in the element's own text or its parent's."""
    for candidate in (element, element.parent):
        if candidate is None:
            continue
        text = clean_cell(candidate.get_text(" ", strip=True))
        match = re.search(r"\d{1,2}[ /-][A-Za-z]{3,9}[ /-]\d{4}|\d{4}-\d{2}-\d{2}", text)
        if match:
            parsed = parse_iso_date(match.group(0).replace("/", "-"))
            if parsed:
                return parsed
    return None


def to_evidence(
    rows: list[PibReleaseRow],
    *,
    ministries: dict[str, str] | None = None,
) -> list[EvidenceRow]:
    lookup = ministries or {}
    return [
        EvidenceRow(
            kind="pib",
            title=row.title,
            url=row.url,
            published_date=row.published_date,
            ministry_id=lookup.get(row.ministry_normalised or ""),
            summary=None,  # written later by the agent layer, at most two sentences
        )
        for row in rows
    ]


def run(
    *,
    conn: psycopg.Connection[dict[str, Any]] | None = None,
    client: PoliteClient | None = None,
    dry_run: bool = False,
    url: str | None = None,
    listing_date: date | None = None,
    ministries: dict[str, str] | None = None,
) -> RunOutcome:
    """Seven steps, in the order docs/02 section 5 fixes them."""
    outcome = RunOutcome(source_id=SOURCE_ID, status="ok")
    owns_client = client is None
    http = client or PoliteClient()

    try:
        with PipelineRun(SOURCE_ID, conn, dry_run=dry_run) as run_ctx:
            ingested = ingest_url(
                url or URLS["all_releases"],
                source_id=SOURCE_ID,
                client=http,
                run=run_ctx,
                conn=conn,
                document_date=listing_date,
            )
            outcome.artifacts.append(ingested.artifact.key)

            rows, parse_errors, columns = parse_release_listing(
                ingested.text, listing_date=listing_date
            )

            validated = validate_rows(rows, PibReleaseRow, source_id=SOURCE_ID, allow_empty=True)
            outcome.rows_parsed = len(validated)
            outcome.parse_errors = len(parse_errors)

            metrics = RunMetrics(
                row_count=len(validated),
                columns=tuple(columns),
                parse_error_count=len(parse_errors),
                extra={
                    "with_ministry": sum(1 for row in validated if row.ministry_normalised),
                    "with_amount_mention": sum(1 for row in validated if row.amount_mentions),
                },
            )
            run_ctx.set_run_metrics(metrics)

            findings = sanity_check(metrics, run_ctx.baseline())
            outcome.drift = [finding.to_jsonable() for finding in findings]
            run_ctx.abort_if_drifted(findings)

            evidence = to_evidence(validated, ministries=ministries)
            if conn is not None and not run_ctx.dry_run and ingested.source_record_id is not None:
                outcome.facts_written = _upsert_evidence(
                    conn, evidence, source_record_id=ingested.source_record_id
                )
            else:
                outcome.notes.append("dry run: nothing written")

            run_ctx.metric(evidence_written=outcome.facts_written)

        # Status comes from the run context, which has just written the
        # pipeline_run row. Informational findings are recorded; only warn and
        # high make a run a drift alert.
        outcome.status = run_ctx.status
    finally:
        if owns_client:
            http.close()

    return outcome


def _upsert_evidence(
    conn: psycopg.Connection[dict[str, Any]],
    rows: list[EvidenceRow],
    *,
    source_record_id: int,
) -> int:
    """Insert evidence rows, idempotent on ``(kind, url)``."""
    if not rows:
        return 0
    written = 0
    with conn.cursor() as cur:
        for row in rows:
            cur.execute(
                """
                INSERT INTO evidence_item
                  (kind, title, url, published_date, ministry_id, scheme_id, summary,
                   source_record_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (kind, url) DO UPDATE SET
                  title          = EXCLUDED.title,
                  published_date = COALESCE(EXCLUDED.published_date,
                                            evidence_item.published_date),
                  ministry_id    = COALESCE(EXCLUDED.ministry_id, evidence_item.ministry_id)
                """,
                (
                    row.kind,
                    row.title,
                    row.url,
                    row.published_date,
                    row.ministry_id,
                    row.scheme_id,
                    row.summary,
                    source_record_id,
                ),
            )
            written += 1
    return written
