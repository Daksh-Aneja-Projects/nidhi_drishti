"""Table confidence and record extraction tests.

No PDF is opened here. The scoring and record-shaping functions take grids, so
they are tested against grids that look like what pdfplumber returns from a
budget statement: a good one, a shifted one, and a page of prose.
"""

from __future__ import annotations

from decimal import Decimal

from pipelines.parsers.inr_amounts import CRORE
from pipelines.parsers.pdf_table import (
    LOW_CONFIDENCE_THRESHOLD,
    ExtractedTable,
    TableConfidence,
    detect_header,
    find_unit_hint,
    is_total_row,
    looks_numeric,
    rows_to_records,
    score_table,
)

GOOD_TABLE = [
    ["Ministry / Department", "2024-25 Actuals", "2025-26 BE", "2025-26 RE"],
    ["Ministry of Defence", "5,50,000.00", "6,21,940.85", "6,30,000.00"],
    ["Ministry of Railways", "2,40,000.00", "2,55,445.00", "2,52,000.00"],
    ["Department of Health and Family Welfare", "88,956.00", "95,957.87", "94,000.00"],
    ["Ministry of Education", "1,08,878.00", "1,28,650.05", "1,25,000.00"],
]

RAGGED_TABLE = [
    ["Ministry / Department", "2025-26 BE"],
    ["Ministry of Defence", "6,21,940.85", "stray"],
    ["Ministry of Railways"],
    ["", ""],
    ["Ministry of Education", "1,28,650.05"],
]

PROSE_TABLE = [
    ["The Minister of Finance presented the Budget", "on the first of February"],
    ["The statement below sets out the demands", "for grants of each ministry"],
    ["Figures have been rounded", "to the nearest crore"],
]


class TestLooksNumeric:
    def test_indian_grouped_figures(self) -> None:
        assert looks_numeric("6,21,940.85")
        assert looks_numeric("₹1,234")
        assert looks_numeric("(1,234)")
        assert looks_numeric("1234 cr")

    def test_labels_and_blanks(self) -> None:
        assert not looks_numeric("Ministry of Defence")
        assert not looks_numeric("")
        assert not looks_numeric("-")
        assert not looks_numeric(None)


class TestScoring:
    def test_a_clean_financial_table_scores_high(self) -> None:
        confidence = score_table(GOOD_TABLE)
        assert confidence.score > LOW_CONFIDENCE_THRESHOLD
        assert confidence.fill_rate == 1.0
        assert confidence.width_consistency == 1.0
        assert confidence.column_count == 4

    def test_a_ragged_grid_scores_low(self) -> None:
        confidence = score_table(RAGGED_TABLE)
        assert confidence.score < LOW_CONFIDENCE_THRESHOLD
        assert confidence.is_low
        assert confidence.reasons

    def test_a_page_of_prose_scores_low_despite_being_rectangular(self) -> None:
        """A perfect grid of sentences is not a financial table."""
        confidence = score_table(PROSE_TABLE)
        assert confidence.width_consistency == 1.0
        assert confidence.numeric_rate == 0.0
        assert confidence.is_low

    def test_an_empty_grid_is_unusable(self) -> None:
        confidence = score_table([])
        assert confidence.score == 0.0
        assert confidence.is_unusable

    def test_a_single_column_is_not_a_table(self) -> None:
        confidence = score_table([["a"], ["b"], ["c"]])
        assert confidence.is_unusable

    def test_confidence_is_bounded(self) -> None:
        assert 0.0 <= score_table(GOOD_TABLE).score <= 1.0


class TestHeaderAndUnit:
    def test_header_is_the_first_mostly_textual_row(self) -> None:
        index, header = detect_header(GOOD_TABLE)
        assert index == 0
        assert header[0] == "Ministry / Department"

    def test_a_single_cell_caption_row_is_skipped(self) -> None:
        """A caption is not a header. The real header sits underneath it."""
        table = [["(₹ in crore)", ""], *GOOD_TABLE]
        index, header = detect_header(table)
        assert index == 1
        assert header[0] == "Ministry / Department"

    def test_unit_from_a_caption(self) -> None:
        assert find_unit_hint(("Ministry", "Amount"), "Statement 4A (₹ in crore)") is CRORE

    def test_no_unit_anywhere_returns_none(self) -> None:
        assert find_unit_hint(("Ministry", "Amount"), "Statement 4A") is None


class TestRowsToRecords:
    def _table(self, unit: object = CRORE) -> ExtractedTable:
        return ExtractedTable(
            rows=GOOD_TABLE,
            page_number=12,
            confidence=score_table(GOOD_TABLE),
            header=tuple(GOOD_TABLE[0]),
            unit_hint=unit,
        )

    def test_records_use_the_unit_hint(self) -> None:
        records, errors = rows_to_records(self._table(), value_columns={"BE": 2, "RE": 3})
        assert errors == []
        assert records[0]["label"] == "Ministry of Defence"
        assert records[0]["BE"] == Decimal("621940.85")
        assert records[0]["RE"] == Decimal("630000.00")

    def test_the_header_row_is_not_a_record(self) -> None:
        records, _ = rows_to_records(self._table(), value_columns={"BE": 2})
        assert all(record["label"] != "Ministry / Department" for record in records)

    def test_without_a_unit_every_cell_becomes_a_parse_error(self) -> None:
        """The document stated no unit, so nothing is guessed."""
        records, errors = rows_to_records(self._table(unit=None), value_columns={"BE": 2})
        assert len(errors) == 4
        assert all("no unit" in error["reason"] for error in errors)
        assert all(record.get("BE") is None for record in records)

    def test_parse_errors_carry_enough_context_to_review(self) -> None:
        _, errors = rows_to_records(self._table(unit=None), value_columns={"BE": 2})
        context = errors[0]["raw_context"]
        assert context["page"] == 12
        assert context["field"] == "BE"
        assert context["label"]


class TestTotalRows:
    def test_total_rows_are_recognised(self) -> None:
        assert is_total_row("Total")
        assert is_total_row("GRAND TOTAL")
        assert is_total_row("Total Expenditure")
        assert is_total_row("Total - Ministry of Defence")

    def test_ministries_are_not(self) -> None:
        assert not is_total_row("Ministry of Defence")
        assert not is_total_row("Department of Total Sanitation")


class TestAssistHook:
    def test_the_assist_is_only_taken_when_it_improves_the_grid(self) -> None:
        """An agent that returns a worse grid must not overwrite a usable one."""
        from pipelines.parsers.pdf_table import _finalise

        def worse_assist(**_: object) -> list[list[str]]:
            return [["garbage"], ["garbage"]]

        result = _finalise(
            rows=RAGGED_TABLE,
            page_number=1,
            page_text="Statement (₹ in crore)",
            assist=worse_assist,
        )
        assert result.extraction_method == "pdf_table"
        assert any("discarded" in note for note in result.notes)

    def test_a_better_grid_is_taken_and_labelled_agent_assisted(self) -> None:
        from pipelines.parsers.pdf_table import _finalise

        def good_assist(**_: object) -> list[list[str]]:
            return GOOD_TABLE

        result = _finalise(
            rows=RAGGED_TABLE,
            page_number=1,
            page_text="Statement (₹ in crore)",
            assist=good_assist,
        )
        assert result.extraction_method == "agent_assisted"
        assert result.unit_hint is CRORE

    def test_an_assist_that_raises_does_not_break_ingestion(self) -> None:
        from pipelines.parsers.pdf_table import _finalise

        def broken_assist(**_: object) -> list[list[str]]:
            raise RuntimeError("model unavailable")

        result = _finalise(
            rows=RAGGED_TABLE, page_number=1, page_text="(₹ in crore)", assist=broken_assist
        )
        assert result.extraction_method == "pdf_table"

    def test_no_assist_is_fine(self) -> None:
        from pipelines.parsers.pdf_table import _finalise

        result = _finalise(rows=GOOD_TABLE, page_number=3, page_text="(₹ in crore)", assist=None)
        assert isinstance(result.confidence, TableConfidence)
        assert result.unit_hint is CRORE
