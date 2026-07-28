"""Parliament questions and answers (sansad.in).

The sleeper source. Ministries' written answers routinely contain scheme
utilisation tables that appear in no other public document, and they arrive with
their own citation attached: a question number, a date, and a named minister.

Two outputs from one document:

* an ``evidence_item`` for the answer itself, always;
* ``UTILIZATION`` facts where the answer contains a scheme-wise table we can
  read with confidence. Where we cannot, the table goes to the parse-error queue
  rather than being approximated, because a utilisation figure is the single
  most consequential number this product publishes about a scheme.

Available only when a House is in session, so a run that finds nothing new is
normal and is reported as such rather than as a failure.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

import psycopg
import structlog
from pydantic import BaseModel, ConfigDict, Field

from pipelines.lib.drift import RunMetrics, sanity_check
from pipelines.lib.fetch import PoliteClient
from pipelines.lib.ingest import ingest_url
from pipelines.lib.models import EvidenceRow, FiscalFactRow
from pipelines.lib.runs import PipelineRun
from pipelines.lib.validation import validate_rows
from pipelines.parsers.fy_dates import fy_end, fy_from_indian_label, is_fy
from pipelines.parsers.pdf_table import ExtractionAssist, extract_tables, is_total_row
from pipelines.parsers.text_norm import clean_cell, normalise_org_name
from pipelines.sources._common import RunOutcome, parse_iso_date, soup_of

log = structlog.get_logger(__name__)

SOURCE_ID = "sansad_qa"

URLS: dict[str, str] = {
    "home": "https://sansad.in/",
    # Question search views. Both Houses publish answers as PDFs.
    "lok_sabha_questions": "https://sansad.in/ls/questions/questions-and-answers",
    "rajya_sabha_questions": "https://sansad.in/rs/questions/questions-and-answers",
}

_QUESTION_NUMBER = re.compile(r"(?:question|q\.?)\s*(?:no\.?)?\s*[:\-]?\s*(\d{1,5})", re.I)
_FY_IN_TEXT = re.compile(r"(20\d{2}\s*[-/]\s*\d{2,4})")


@dataclass(frozen=True, slots=True)
class AnswerDocument:
    """A written answer, as listed before its PDF is fetched."""

    question_number: str
    title: str
    url: str
    ministry_raw: str | None
    answered_on: date | None
    house: str


class SansadAnswerRow(BaseModel):
    """One listed written answer."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    question_number: str = Field(min_length=1)
    title: str = Field(min_length=5)
    url: str = Field(min_length=10)
    house: str = Field(pattern=r"^(lok_sabha|rajya_sabha)$")
    ministry_raw: str | None = None
    ministry_normalised: str | None = None
    answered_on: date | None = None


class SansadUtilizationRow(BaseModel):
    """A scheme utilisation figure read out of an answer's table."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    question_number: str = Field(min_length=1)
    scheme_raw: str = Field(min_length=2)
    scheme_normalised: str = Field(min_length=2)
    fy: str = Field(pattern=r"^FY\d{4}$")
    utilized_inr_cr: Decimal
    page_number: int | None = None
    confidence: float | None = None


def parse_answer_listing(
    markup: str,
    *,
    house: str,
    base_url: str = "https://sansad.in",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """Parse the questions listing into answer references."""
    document = soup_of(markup)
    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    seen: set[str] = set()

    for anchor in document.find_all("a", href=True):
        href = str(anchor["href"]).strip()
        title = clean_cell(anchor.get_text(" ", strip=True))
        if not href.lower().split("?")[0].endswith(".pdf") or len(title) < 5:
            continue

        container = anchor.find_parent(["tr", "li", "div"]) or anchor
        context_text = clean_cell(container.get_text(" ", strip=True))
        match = _QUESTION_NUMBER.search(context_text) or _QUESTION_NUMBER.search(title)
        question_number = match.group(1) if match else href.rsplit("/", 1)[-1].split(".")[0]
        if question_number in seen:
            continue
        seen.add(question_number)

        ministry = _ministry_from_context(context_text)
        rows.append(
            {
                "question_number": question_number,
                "title": title,
                "url": href if href.startswith("http") else f"{base_url}/{href.lstrip('/')}",
                "house": house,
                "ministry_raw": ministry,
                "ministry_normalised": normalise_org_name(ministry) if ministry else None,
                "answered_on": _date_from_context(context_text),
            }
        )

    if not rows:
        errors.append(
            {
                "reason": "No answer PDFs were found in the listing. Either no House is in "
                "session, or the listing has changed structure.",
                "stage_hint": "parliament_qa",
                "raw_context": {"house": house, "length": len(markup)},
            }
        )

    return rows, errors, ["question_number", "title", "ministry", "answered_on"]


def _ministry_from_context(text: str) -> str | None:
    match = re.search(r"(ministry of [A-Za-z ,&]+|department of [A-Za-z ,&]+)", text, re.IGNORECASE)
    return clean_cell(match.group(1)) if match else None


def _date_from_context(text: str) -> date | None:
    match = re.search(r"\d{1,2}[ /-][A-Za-z]{3,9}[ /-]\d{4}|\d{4}-\d{2}-\d{2}", text)
    return parse_iso_date(match.group(0).replace("/", "-")) if match else None


def parse_utilization_tables(
    pdf_bytes: bytes,
    *,
    question_number: str,
    default_fy: str | None = None,
    assist: ExtractionAssist | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Read scheme utilisation tables out of an answer PDF.

    Only tables that name a fiscal year and carry a stated unit are read. An
    answer whose table has neither is queued: a utilisation percentage is the
    figure most likely to be quoted back at us, and it has to be right.
    """
    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    for table in extract_tables(pdf_bytes, assist=assist):
        if table.confidence.is_unusable:
            errors.append(
                {
                    "reason": f"Table confidence {table.confidence.score} is too low to read a "
                    f"utilisation figure from: {'; '.join(table.confidence.reasons)}",
                    "stage_hint": "UTILIZATION",
                    "raw_context": {
                        "question_number": question_number,
                        "page": table.page_number,
                    },
                }
            )
            continue

        utilisation_index = next(
            (
                index
                for index, cell in enumerate(table.header)
                if any(
                    word in cell.lower() for word in ("utilis", "utiliz", "expenditure", "spent")
                )
            ),
            None,
        )
        if utilisation_index is None:
            continue

        fy = _fy_from_header(table.header) or default_fy
        if fy is None:
            errors.append(
                {
                    "reason": "The table states no fiscal year, so its utilisation figures "
                    "cannot be placed in one.",
                    "stage_hint": "UTILIZATION",
                    "raw_context": {
                        "question_number": question_number,
                        "header": list(table.header),
                    },
                }
            )
            continue

        from pipelines.parsers.pdf_table import rows_to_records

        records, cell_errors = rows_to_records(table, value_columns={"utilized": utilisation_index})
        errors.extend(cell_errors)

        for record in records:
            label = str(record["label"])
            amount = record.get("utilized")
            if amount is None or is_total_row(label):
                continue
            rows.append(
                {
                    "question_number": question_number,
                    "scheme_raw": label,
                    "scheme_normalised": normalise_org_name(label),
                    "fy": fy,
                    "utilized_inr_cr": amount,
                    "page_number": table.page_number,
                    "confidence": table.confidence.score,
                }
            )

    return rows, errors


def _fy_from_header(header: tuple[str, ...]) -> str | None:
    for cell in header:
        match = _FY_IN_TEXT.search(cell)
        if match:
            try:
                return fy_from_indian_label(match.group(1))
            except Exception:  # noqa: BLE001 - not every year pair is a fiscal year
                continue
        if is_fy(clean_cell(cell)):
            return clean_cell(cell)
    return None


def to_facts(
    rows: list[SansadUtilizationRow],
    *,
    resolve_scheme: dict[str, str] | None = None,
) -> tuple[list[FiscalFactRow], list[dict[str, Any]]]:
    aliases = resolve_scheme or {}
    facts: list[FiscalFactRow] = []
    unresolved: list[dict[str, Any]] = []
    for row in rows:
        scheme_id = aliases.get(row.scheme_normalised)
        if scheme_id is None:
            unresolved.append(
                {
                    "reason": "No entity_alias maps this scheme name to a stable id.",
                    "stage_hint": "UTILIZATION",
                    "raw_context": {
                        "scheme_raw": row.scheme_raw,
                        "question_number": row.question_number,
                    },
                }
            )
            continue
        facts.append(
            FiscalFactRow(
                fy=row.fy,
                entity_type="scheme",
                entity_id=scheme_id,
                stage="UTILIZATION",
                head="total",
                period_end=fy_end(row.fy),
                is_cumulative=True,
                amount_inr_cr=row.utilized_inr_cr,
                extraction_method="pdf_table",
            )
        )
    return facts, unresolved


def to_evidence(rows: list[SansadAnswerRow]) -> list[EvidenceRow]:
    return [
        EvidenceRow(
            kind="parliament_qa",
            title=f"{row.house.replace('_', ' ').title()} question {row.question_number}: "
            f"{row.title}",
            url=row.url,
            published_date=row.answered_on,
            summary=None,
        )
        for row in rows
    ]


def run(
    *,
    house: str = "lok_sabha",
    conn: psycopg.Connection[dict[str, Any]] | None = None,
    client: PoliteClient | None = None,
    dry_run: bool = False,
    url: str | None = None,
    max_answers: int = 25,
    default_fy: str | None = None,
    assist: ExtractionAssist | None = None,
    resolve_scheme: dict[str, str] | None = None,
) -> RunOutcome:
    """Seven steps, in the order docs/02 section 5 fixes them.

    ``max_answers`` bounds how many PDFs one run pulls. At one request every two
    seconds this is also a politeness bound: a session can produce hundreds of
    answers, and there is no reason to take them all in one sitting.
    """
    outcome = RunOutcome(source_id=SOURCE_ID, status="ok")
    owns_client = client is None
    http = client or PoliteClient()
    listing_url = url or URLS[f"{house}_questions"]

    try:
        with PipelineRun(SOURCE_ID, conn, dry_run=dry_run) as run_ctx:
            listing = ingest_url(
                listing_url, source_id=SOURCE_ID, client=http, run=run_ctx, conn=conn
            )
            outcome.artifacts.append(listing.artifact.key)

            answer_rows, parse_errors, columns = parse_answer_listing(listing.text, house=house)
            answers = validate_rows(
                answer_rows, SansadAnswerRow, source_id=SOURCE_ID, allow_empty=True
            )
            outcome.rows_parsed = len(answers)

            utilization_rows: list[dict[str, Any]] = []
            for answer in answers[:max_answers]:
                document = ingest_url(
                    answer.url,
                    source_id=SOURCE_ID,
                    client=http,
                    run=run_ctx,
                    conn=conn,
                    document_date=answer.answered_on,
                )
                outcome.artifacts.append(document.artifact.key)
                rows, errors = parse_utilization_tables(
                    document.content,
                    question_number=answer.question_number,
                    default_fy=default_fy,
                    assist=assist,
                )
                utilization_rows.extend(rows)
                parse_errors.extend(errors)

            utilizations = validate_rows(
                utilization_rows, SansadUtilizationRow, source_id=SOURCE_ID, allow_empty=True
            )
            outcome.parse_errors = len(parse_errors)

            metrics = RunMetrics(
                row_count=len(answers),
                total_amount_inr_cr=(
                    sum((row.utilized_inr_cr for row in utilizations), Decimal(0))
                    if utilizations
                    else None
                ),
                columns=tuple(columns),
                parse_error_count=len(parse_errors),
                extra={"utilization_rows": len(utilizations)},
            )
            run_ctx.set_run_metrics(metrics)

            findings = sanity_check(metrics, run_ctx.baseline())
            outcome.drift = [finding.to_jsonable() for finding in findings]
            run_ctx.abort_if_drifted(findings)

            if resolve_scheme is None:
                from pipelines.lib.db import load_alias_map

                resolve_scheme = load_alias_map(conn, "scheme")
            facts, unresolved = to_facts(utilizations, resolve_scheme=resolve_scheme)
            outcome.parse_errors += len(unresolved)
            if conn is not None and not run_ctx.dry_run and listing.source_record_id is not None:
                from pipelines.lib.db import (
                    record_parse_errors,
                    refresh_materialized_views,
                    upsert_fiscal_facts,
                )

                outcome.facts_written = upsert_fiscal_facts(
                    conn, facts, source_record_id=listing.source_record_id
                )
                record_parse_errors(
                    conn,
                    [*parse_errors, *unresolved],
                    source_record_id=listing.source_record_id,
                    pipeline_run_id=run_ctx.run_id,
                )
                refresh_materialized_views(conn)
            else:
                outcome.notes.append("dry run: nothing written")

            run_ctx.metric(facts_written=outcome.facts_written, answers_seen=len(answers))

        # Status comes from the run context, which has just written the
        # pipeline_run row. Informational findings are recorded; only warn and
        # high make a run a drift alert.
        outcome.status = run_ctx.status
    finally:
        if owns_client:
            http.close()

    return outcome
