"""PDF table extraction with an honest confidence score.

Government budget PDFs are the boss fight. Some are born digital with real table
rules and extract perfectly; some are scans; many are digital but rule-less, and
pdfplumber returns a plausible-looking grid whose columns have quietly shifted
by one. The last case is the dangerous one, because it produces numbers.

So every extraction carries a confidence score computed from properties we can
check without knowing the right answer: how full the grid is, how consistent the
row widths are, how many cells in the numeric columns actually parse as numbers.
Below a threshold the extraction is handed to an assist callable, which in
production is the A1 extraction-assist agent.

This module never imports from /agents. The assist is passed in as a callable,
so the parser stays a pure function of its inputs and the agent layer stays
optional, testable and replaceable.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Protocol

import structlog

from pipelines.parsers.inr_amounts import (
    NOT_REPORTED_TOKENS,
    AmountParseError,
    Unit,
    parse_amount_cr,
    parse_unit_hint,
)

log = structlog.get_logger(__name__)

Row = list[str | None]
Table = list[Row]

#: Below this, an extraction is not trusted on its own and the assist is called.
LOW_CONFIDENCE_THRESHOLD = 0.60
#: Below this, even an assisted extraction is queued for a human rather than
#: written. A near-empty grid is not a table.
UNUSABLE_THRESHOLD = 0.25

_NUMERIC_LIKE = re.compile(r"^[\s(]*[₹₨]?\s*[-+]?[\d,]*\d(?:\.\d+)?[\s)]*(?:[a-z.]{2,12})?$", re.I)


class ExtractionAssist(Protocol):
    """The shape the A1 agent has to satisfy. Deliberately minimal.

    Implemented in /agents and passed in. It receives the page text, the grid
    pdfplumber managed to find, and the reason confidence was low, and returns a
    better grid or None if it cannot do better.
    """

    def __call__(
        self,
        *,
        page_text: str,
        candidate_table: Table,
        reason: str,
        page_number: int,
    ) -> Table | None: ...


@dataclass(frozen=True, slots=True)
class TableConfidence:
    """Why we do or do not trust a grid."""

    score: float
    fill_rate: float
    width_consistency: float
    numeric_rate: float
    row_count: int
    column_count: int
    reasons: tuple[str, ...] = ()

    @property
    def is_low(self) -> bool:
        return self.score < LOW_CONFIDENCE_THRESHOLD

    @property
    def is_unusable(self) -> bool:
        return self.score < UNUSABLE_THRESHOLD


@dataclass(frozen=True, slots=True)
class ExtractedTable:
    """One table, its confidence, and how it was obtained."""

    rows: Table
    page_number: int
    confidence: TableConfidence
    #: 'pdf_table' for pdfplumber, 'agent_assisted' when the assist produced it.
    #: Written straight into ``fiscal_fact.extraction_method`` so the provenance
    #: popover can say how a figure was read.
    extraction_method: str = "pdf_table"
    header: tuple[str, ...] = ()
    unit_hint: Unit | None = None
    notes: tuple[str, ...] = field(default=())


def _clean(cell: str | None) -> str:
    if cell is None:
        return ""
    return " ".join(str(cell).replace("\n", " ").split())


def looks_numeric(cell: str | None) -> bool:
    """True when a cell looks like a figure rather than prose or a label."""
    text = _clean(cell)
    if not text or text.lower() in NOT_REPORTED_TOKENS:
        return False
    return bool(_NUMERIC_LIKE.match(text))


def score_table(rows: Sequence[Sequence[str | None]]) -> TableConfidence:
    """Score a grid without knowing what it should contain.

    Three signals, multiplied so that a failure in any one of them drags the
    score down rather than being averaged away:

    * **fill rate**: share of non-empty cells. A grid that is mostly blank is
      usually a mis-detected page, not a sparse table.
    * **width consistency**: share of rows with the modal column count. A table
      whose rows disagree about how many columns exist has had its cells merged
      or split, which is exactly how a figure lands in the wrong year's column.
    * **numeric rate**: share of cells outside the first column that read as
      numbers. A financial table that is mostly prose was not a financial table.
    """
    reasons: list[str] = []
    grid = [list(row) for row in rows]
    row_count = len(grid)
    if row_count == 0:
        return TableConfidence(0.0, 0.0, 0.0, 0.0, 0, 0, ("no rows",))

    widths = [len(row) for row in grid]
    modal_width = max(set(widths), key=widths.count)
    if modal_width < 2:
        return TableConfidence(0.0, 0.0, 0.0, 0.0, row_count, modal_width, ("single column",))

    total_cells = sum(widths)
    filled = sum(1 for row in grid for cell in row if _clean(cell))
    fill_rate = filled / total_cells if total_cells else 0.0

    consistent_rows = sum(1 for width in widths if width == modal_width)
    width_consistency = consistent_rows / row_count

    value_cells = [cell for row in grid for cell in row[1:] if _clean(cell)]
    numeric_rate = (
        sum(1 for cell in value_cells if looks_numeric(cell)) / len(value_cells)
        if value_cells
        else 0.0
    )

    if fill_rate < 0.5:
        reasons.append(f"only {fill_rate * 100:.0f} percent of cells are filled")
    if width_consistency < 0.9:
        reasons.append(f"{row_count - consistent_rows} of {row_count} rows have an odd width")
    if numeric_rate < 0.5:
        reasons.append(f"only {numeric_rate * 100:.0f} percent of value cells look numeric")
    if row_count < 3:
        reasons.append("fewer than three rows")

    # Geometric-style combination: a zero in any component is fatal, which is
    # the intent. An arithmetic mean would let a perfectly rectangular grid of
    # prose score 0.66 and be trusted.
    score = (fill_rate**0.5) * width_consistency * (0.3 + 0.7 * numeric_rate)
    if row_count < 3:
        score *= 0.6

    return TableConfidence(
        score=round(min(score, 1.0), 4),
        fill_rate=round(fill_rate, 4),
        width_consistency=round(width_consistency, 4),
        numeric_rate=round(numeric_rate, 4),
        row_count=row_count,
        column_count=modal_width,
        reasons=tuple(reasons),
    )


def detect_header(rows: Sequence[Sequence[str | None]]) -> tuple[int, tuple[str, ...]]:
    """Find the header row: the first row whose cells are mostly non-numeric.

    Returns ``(index, header)``, or ``(-1, ())`` when no row looks like one.
    """
    for index, row in enumerate(rows[:6]):
        cells = [_clean(cell) for cell in row]
        populated = [cell for cell in cells if cell]
        if len(populated) < 2:
            continue
        numeric = sum(1 for cell in populated if looks_numeric(cell))
        if numeric / len(populated) < 0.34:
            return index, tuple(cells)
    return -1, ()


def find_unit_hint(header: Sequence[str], *captions: str) -> Unit | None:
    """Look for the unit in the header cells, then in surrounding captions.

    Budget tables put ``(₹ in crore)`` in a column header, a caption above the
    table, or the page footer, and the parser has to check all three before
    concluding that the numbers are unitless.
    """
    for cell in header:
        unit = parse_unit_hint(cell)
        if unit is not None:
            return unit
    for caption in captions:
        unit = parse_unit_hint(caption)
        if unit is not None:
            return unit
    return None


def extract_tables(
    pdf_bytes: bytes,
    *,
    pages: Sequence[int] | None = None,
    assist: ExtractionAssist | None = None,
    table_settings: dict[str, Any] | None = None,
) -> list[ExtractedTable]:
    """Extract every table from a PDF, scoring each and assisting the weak ones.

    ``pages`` is one-based page numbers, matching what a person reading the PDF
    sees, because these page references end up in provenance strings.
    """
    import pdfplumber  # imported lazily: importing it costs about a second

    results: list[ExtractedTable] = []
    with pdfplumber.open(_as_stream(pdf_bytes)) as pdf:
        for zero_based, page in enumerate(pdf.pages):
            page_number = zero_based + 1
            if pages is not None and page_number not in pages:
                continue
            page_text = page.extract_text() or ""
            raw_tables = page.extract_tables(table_settings or {}) or []
            for candidate in raw_tables:
                results.append(
                    _finalise(
                        rows=[[_clean(cell) for cell in row] for row in candidate],
                        page_number=page_number,
                        page_text=page_text,
                        assist=assist,
                    )
                )
    log.info("pdf.tables_extracted", tables=len(results))
    return results


def _as_stream(pdf_bytes: bytes) -> Any:
    import io

    return io.BytesIO(pdf_bytes)


def _finalise(
    *,
    rows: Table,
    page_number: int,
    page_text: str,
    assist: ExtractionAssist | None,
) -> ExtractedTable:
    confidence = score_table(rows)
    method = "pdf_table"
    notes: list[str] = []

    if confidence.is_low and assist is not None:
        reason = "; ".join(confidence.reasons) or "confidence below threshold"
        log.info(
            "pdf.assist_invoked", page=page_number, score=confidence.score, reason=reason
        )
        try:
            assisted = assist(
                page_text=page_text,
                candidate_table=rows,
                reason=reason,
                page_number=page_number,
            )
        except Exception as exc:  # noqa: BLE001 - the agent layer must not break ingestion
            log.warning("pdf.assist_failed", page=page_number, error=str(exc))
            assisted = None
        if assisted:
            assisted_rows = [[_clean(cell) for cell in row] for row in assisted]
            assisted_confidence = score_table(assisted_rows)
            # Only accept the assist if it is actually better. An agent that
            # returns a worse grid must not be able to overwrite a usable one.
            if assisted_confidence.score > confidence.score:
                rows = assisted_rows
                confidence = assisted_confidence
                method = "agent_assisted"
                notes.append(f"extraction assisted on page {page_number}")
            else:
                notes.append("assist returned a lower-confidence grid and was discarded")

    header_index, header = detect_header(rows)
    unit_hint = find_unit_hint(header, page_text[:400]) if header else parse_unit_hint(
        page_text[:400]
    )
    if unit_hint is None:
        notes.append(
            "no unit stated in the header or the surrounding text, so bare figures in this "
            "table are ambiguous and will be queued rather than parsed"
        )
    del header_index

    return ExtractedTable(
        rows=rows,
        page_number=page_number,
        confidence=confidence,
        extraction_method=method,
        header=header,
        unit_hint=unit_hint,
        notes=tuple(notes),
    )


def rows_to_records(
    table: ExtractedTable,
    *,
    label_column: int = 0,
    value_columns: dict[str, int] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Turn a scored table into ``(records, parse_errors)``.

    ``value_columns`` maps an output field name to a column index, for example
    ``{"be": 1, "re": 2, "actuals": 3}``. Amounts are parsed with the table's
    unit hint; a cell with no unit and no hint produces a parse-error entry
    rather than a number, which is the whole discipline of docs/04 section 5.
    """
    records: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    columns = value_columns or {}

    header_index, _ = detect_header(table.rows)
    for row_index, row in enumerate(table.rows):
        if row_index <= header_index:
            continue
        label = _clean(row[label_column]) if len(row) > label_column else ""
        if not label:
            continue

        record: dict[str, Any] = {"label": label, "row_index": row_index}
        row_failed = False
        for field_name, column_index in columns.items():
            cell = _clean(row[column_index]) if len(row) > column_index else ""
            try:
                amount = parse_amount_cr(cell, unit_hint=table.unit_hint)
            except AmountParseError as exc:
                errors.append(
                    {
                        "reason": str(exc),
                        "stage_hint": field_name,
                        "raw_context": {
                            "label": label,
                            "field": field_name,
                            "cell": cell,
                            "page": table.page_number,
                            "row_index": row_index,
                        },
                    }
                )
                row_failed = True
                continue
            record[field_name] = amount if isinstance(amount, Decimal) else None
        if not row_failed or len(record) > 2:
            records.append(record)

    return records, errors


def is_total_row(label: str) -> bool:
    """Grand-total rows sit inside these tables and must not be double counted."""
    normalised = re.sub(r"[^a-z ]", "", label.lower()).strip()
    return normalised in {
        "total",
        "grand total",
        "grand total",
        "total expenditure",
        "total receipts",
        "gross total",
        "net total",
        "total of ministry",
    } or normalised.startswith("total ")


__all__ = [
    "LOW_CONFIDENCE_THRESHOLD",
    "UNUSABLE_THRESHOLD",
    "ExtractedTable",
    "ExtractionAssist",
    "TableConfidence",
    "detect_header",
    "extract_tables",
    "find_unit_hint",
    "is_total_row",
    "looks_numeric",
    "rows_to_records",
    "score_table",
]
