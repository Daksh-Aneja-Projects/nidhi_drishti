"""Small helpers every source module shares.

Nothing here hides a pipeline step. The seven steps of docs/02 section 5 stay
written out in each source module, because a reader has to be able to see the
order without following a base class. These are only the repeated fragments
inside those steps.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import structlog
from bs4 import BeautifulSoup

log = structlog.get_logger(__name__)


@dataclass
class RunOutcome:
    """What a pipeline did, returned to the CLI and to tests."""

    source_id: str
    status: str
    rows_parsed: int = 0
    facts_written: int = 0
    parse_errors: int = 0
    drift: list[dict[str, Any]] = field(default_factory=list)
    artifacts: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "source_id": self.source_id,
            "status": self.status,
            "rows_parsed": self.rows_parsed,
            "facts_written": self.facts_written,
            "parse_errors": self.parse_errors,
            "drift": self.drift,
            "artifacts": self.artifacts,
            "notes": self.notes,
        }


def soup_of(markup: str | bytes) -> BeautifulSoup:
    """Parse HTML with lxml, falling back to the stdlib parser.

    Government pages are frequently invalid HTML, sometimes with unterminated
    tables. lxml is far more forgiving than html.parser and much faster, but the
    fallback keeps a malformed page from taking the whole run down.
    """
    try:
        return BeautifulSoup(markup, "lxml")
    except Exception:  # noqa: BLE001 - lxml raising here is rare and recoverable
        log.warning("html.lxml_failed_falling_back")
        return BeautifulSoup(markup, "html.parser")


def table_rows(table: Any) -> list[list[str]]:
    """Extract an HTML table as a list of trimmed cell lists."""
    rows: list[list[str]] = []
    for tr in table.find_all("tr"):
        cells = [
            " ".join(cell.get_text(" ", strip=True).split()) for cell in tr.find_all(["td", "th"])
        ]
        if any(cells):
            rows.append(cells)
    return rows


def first_table_with_headers(markup: str | bytes, headers: Sequence[str]) -> list[list[str]]:
    """Find the first table whose header row mentions all of ``headers``.

    Positional table indexing ("the third table on the page") is the single most
    fragile thing a scraper can do, because a portal adding a banner shifts every
    index. Matching on header text survives that, and failing to match is a clean
    drift signal rather than a silently wrong table.
    """
    wanted = [header.lower() for header in headers]
    for table in soup_of(markup).find_all("table"):
        rows = table_rows(table)
        if not rows:
            continue
        haystack = " ".join(rows[0]).lower()
        if all(header in haystack for header in wanted):
            return rows
    return []


def all_links(markup: str | bytes, *, suffix: str | None = None) -> list[tuple[str, str]]:
    """``(href, text)`` for every anchor, optionally filtered by href suffix."""
    links: list[tuple[str, str]] = []
    for anchor in soup_of(markup).find_all("a", href=True):
        href = str(anchor["href"]).strip()
        if suffix and not href.lower().split("?")[0].endswith(suffix.lower()):
            continue
        links.append((href, " ".join(anchor.get_text(" ", strip=True).split())))
    return links


def total_of(values: Sequence[Decimal | None]) -> Decimal | None:
    reported = [value for value in values if value is not None]
    if not reported:
        return None
    return sum(reported, Decimal(0))


def parse_iso_date(value: str | None) -> date | None:
    """Read the date formats these portals mix on one page.

    Returns None rather than raising: a missing publication date on a tender is
    a gap in the evidence, not a reason to lose the tender.
    """
    if not value:
        return None
    text = value.strip()
    formats = (
        "%Y-%m-%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%d-%b-%Y",
        "%d %b %Y",
        "%d %B %Y",
        "%b %d, %Y",
        "%d-%m-%Y %H:%M",
        "%d-%b-%Y %I:%M %p",
        "%Y-%m-%dT%H:%M:%S",
    )
    for fmt in formats:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None
