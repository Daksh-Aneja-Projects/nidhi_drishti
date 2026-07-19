"""PFMS published dashboards (pfms.nic.in).

PFMS is the fund-flow backbone for Centrally Sponsored Schemes, and its public
dashboards are the only route to scheme-level release figures. Three constraints
from docs/03 section 1.3 shape everything here:

* **There is no open public API.** Nothing in this module pretends otherwise.
  Only the published public dashboard is read, with no authentication and no
  bypass of any access control.
* **The pages are JavaScript-rendered**, so a headless browser is needed to see
  the numbers a visitor sees. The renderer is isolated in one function so the
  parsing logic stays testable against saved HTML.
* **The figures are cumulative for the financial year.** Two snapshots are two
  views of one running total. They are stored with ``is_cumulative = true`` and
  are never summed, and every derived figure is labelled "as published on the
  PFMS dashboard on <date>" because that is exactly what it is.
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
from pipelines.lib.storage import store_raw
from pipelines.lib.validation import validate_rows
from pipelines.parsers.fy_dates import fy_end, fy_of
from pipelines.parsers.inr_amounts import (
    AmountParseError,
    Unit,
    parse_amount_cr,
    parse_unit_hint,
)
from pipelines.parsers.text_norm import clean_cell, normalise_org_name
from pipelines.sources._common import RunOutcome, soup_of, table_rows

log = structlog.get_logger(__name__)

SOURCE_ID = "pfms_pub"

URLS: dict[str, str] = {
    "home": "https://pfms.nic.in/",
    "dashboard": "https://pfmsdashboard.gov.in/",
    # Scheme-wise release report, public view.
    "scheme_releases": "https://pfms.nic.in/Users/Dashboard/SchemeWiseReleases.aspx",
}

SCHEME_TABLE_HEADERS = ("scheme", "release")

#: Time the renderer waits for the dashboard widgets to settle. Generous,
#: because we would rather wait than take a second run at the page.
RENDER_TIMEOUT_MS = 45_000


class PfmsReleaseRow(BaseModel):
    """One scheme's cumulative release as published on the dashboard."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    scheme_raw: str = Field(min_length=2)
    scheme_normalised: str = Field(min_length=2)
    fy: str = Field(pattern=r"^FY\d{4}$")
    released_inr_cr: Decimal
    as_published_on: date
    is_cumulative: bool = True


def render_dashboard(
    url: str,
    *,
    user_agent: str,
    timeout_ms: int = RENDER_TIMEOUT_MS,
) -> bytes:
    """Render a JavaScript dashboard and return the resulting HTML.

    Playwright is imported lazily so that the browser dependency is only needed
    by the one source that genuinely requires it. The browser is configured with
    the same honest User-Agent as the HTTP client, and it never authenticates,
    never fills a form, and never solves a challenge: it loads the page an
    anonymous visitor loads and reads what is on it.
    """
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            context = browser.new_context(user_agent=user_agent)
            page = context.new_page()
            page.goto(url, timeout=timeout_ms, wait_until="networkidle")
            html = page.content()
        finally:
            browser.close()
    return html.encode("utf-8")


def parse_scheme_releases(
    markup: str,
    *,
    as_published_on: date,
    unit_hint: Unit | None = None,
    fy: str | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """Parse the scheme-wise release table out of the rendered dashboard."""
    document = soup_of(markup)
    page_text = document.get_text(" ", strip=True)
    unit = unit_hint or parse_unit_hint(page_text[:3000])
    resolved_fy = fy or fy_of(as_published_on)

    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    columns: list[str] = []

    target: list[list[str]] = []
    for table in document.find_all("table"):
        candidate = table_rows(table)
        if not candidate:
            continue
        header = " ".join(candidate[0]).lower()
        if all(word in header for word in SCHEME_TABLE_HEADERS):
            target = candidate
            columns = [clean_cell(cell) for cell in candidate[0]]
            break

    if not target:
        log.warning("pfms.scheme_table_not_found")
        return rows, errors, columns

    release_index = next(
        (index for index, name in enumerate(columns) if "release" in name.lower()), 1
    )
    column_unit = parse_unit_hint(columns[release_index]) or unit

    for record in target[1:]:
        if len(record) <= release_index:
            continue
        scheme = clean_cell(record[0])
        if not scheme or scheme.lower().startswith("total"):
            continue
        cell = clean_cell(record[release_index])
        try:
            amount = parse_amount_cr(cell, unit_hint=column_unit)
        except AmountParseError as exc:
            errors.append(
                {
                    "reason": str(exc),
                    "stage_hint": "RELEASE",
                    "raw_context": {"scheme": scheme, "cell": cell, "columns": columns},
                }
            )
            continue
        if not isinstance(amount, Decimal):
            continue
        rows.append(
            {
                "scheme_raw": scheme,
                "scheme_normalised": normalise_org_name(scheme),
                "fy": resolved_fy,
                "released_inr_cr": amount,
                "as_published_on": as_published_on,
                "is_cumulative": True,
            }
        )

    return rows, errors, columns


def to_facts(
    rows: list[PfmsReleaseRow],
    *,
    resolve_scheme: dict[str, str] | None = None,
) -> tuple[list[FiscalFactRow], list[dict[str, Any]]]:
    """Map dashboard rows to RELEASE facts.

    ``period_end`` is the date the dashboard was read, not the end of the year:
    the figure is "released as at this date", and dating it any other way would
    misstate what the source said.
    """
    aliases = resolve_scheme or {}
    facts: list[FiscalFactRow] = []
    unresolved: list[dict[str, Any]] = []
    for row in rows:
        scheme_id = aliases.get(row.scheme_normalised)
        if scheme_id is None:
            unresolved.append(
                {
                    "reason": "No entity_alias maps this scheme name to a stable id.",
                    "stage_hint": "RELEASE",
                    "raw_context": {"scheme_raw": row.scheme_raw},
                }
            )
            continue
        period_end = min(row.as_published_on, fy_end(row.fy))
        facts.append(
            FiscalFactRow(
                fy=row.fy,
                entity_type="scheme",
                entity_id=scheme_id,
                stage="RELEASE",
                head="total",
                period_end=period_end,
                is_cumulative=True,
                amount_inr_cr=row.released_inr_cr,
                extraction_method="html_table",
                is_provisional=True,
            )
        )
    return facts, unresolved


def run(
    *,
    as_published_on: date,
    conn: psycopg.Connection[dict[str, Any]] | None = None,
    client: PoliteClient | None = None,
    dry_run: bool = False,
    url: str | None = None,
    use_browser: bool = True,
    resolve_scheme: dict[str, str] | None = None,
) -> RunOutcome:
    """Seven steps, in the order docs/02 section 5 fixes them."""
    from pipelines.lib.config import get_settings

    settings = get_settings()
    outcome = RunOutcome(source_id=SOURCE_ID, status="ok")
    owns_client = client is None
    http = client or PoliteClient(settings)
    target = url or URLS["scheme_releases"]

    try:
        with PipelineRun(SOURCE_ID, conn, dry_run=dry_run) as run_ctx:
            if use_browser:
                # The robots check still applies: the browser is a different way
                # of making the same request, not a way around the rules.
                if not http.may_fetch(target):
                    raise PermissionError(
                        f"robots.txt disallows {target}. Use a published report or a data.gov.in "
                        f"mirror and record the decision in source_registry.access_note."
                    )
                content = render_dashboard(target, user_agent=settings.scraper.user_agent)
                artifact = store_raw(SOURCE_ID, target, content, "text/html")
                source_record_id: int | None = None
                if conn is not None and not run_ctx.dry_run:
                    from pipelines.lib.db import record_source_record

                    source_record_id = record_source_record(
                        conn,
                        artifact=artifact,
                        fetched_at=run_ctx_now(),
                        document_date=as_published_on,
                        pipeline_run_id=run_ctx.run_id,
                        url=target,
                    )
                markup = content.decode("utf-8", errors="replace")
                outcome.artifacts.append(artifact.key)
            else:
                ingested = ingest_url(
                    target,
                    source_id=SOURCE_ID,
                    client=http,
                    run=run_ctx,
                    conn=conn,
                    document_date=as_published_on,
                )
                markup = ingested.text
                source_record_id = ingested.source_record_id
                outcome.artifacts.append(ingested.artifact.key)

            rows, parse_errors, columns = parse_scheme_releases(
                markup, as_published_on=as_published_on
            )

            validated = validate_rows(rows, PfmsReleaseRow, source_id=SOURCE_ID, allow_empty=True)
            outcome.rows_parsed = len(validated)
            outcome.parse_errors = len(parse_errors)

            metrics = RunMetrics(
                row_count=len(validated),
                total_amount_inr_cr=(
                    sum((row.released_inr_cr for row in validated), Decimal(0))
                    if validated
                    else None
                ),
                columns=tuple(columns),
                parse_error_count=len(parse_errors),
                extra={"as_published_on": as_published_on.isoformat()},
            )
            run_ctx.set_run_metrics(metrics)

            findings = sanity_check(metrics, run_ctx.baseline())
            outcome.drift = [finding.to_jsonable() for finding in findings]
            run_ctx.abort_if_drifted(findings)

            facts, unresolved = to_facts(validated, resolve_scheme=resolve_scheme)
            outcome.parse_errors += len(unresolved)
            if conn is not None and not run_ctx.dry_run and source_record_id is not None:
                from pipelines.lib.db import (
                    record_parse_errors,
                    refresh_materialized_views,
                    upsert_fiscal_facts,
                )

                outcome.facts_written = upsert_fiscal_facts(
                    conn, facts, source_record_id=source_record_id
                )
                record_parse_errors(
                    conn,
                    [*parse_errors, *unresolved],
                    source_record_id=source_record_id,
                    pipeline_run_id=run_ctx.run_id,
                )
                refresh_materialized_views(conn)
            else:
                outcome.notes.append("dry run: nothing written")

            outcome.notes.append(
                f"Figures are as published on the PFMS dashboard on {as_published_on.isoformat()}."
            )
            run_ctx.metric(facts_written=outcome.facts_written)

        # Status comes from the run context, which has just written the
        # pipeline_run row. Informational findings are recorded; only warn and
        # high make a run a drift alert.
        outcome.status = run_ctx.status
    finally:
        if owns_client:
            http.close()

    return outcome


def run_ctx_now() -> Any:
    """Fetch timestamp for the browser path, which has no FetchResult."""
    from datetime import UTC, datetime

    return datetime.now(UTC)
