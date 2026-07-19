"""Currency parsing tests. Required by CLAUDE.md.

The strings here are the shapes that appear in Budget statements, CGA monthly
accounts, PFMS dashboards and parliament answers. The ambiguity cases matter
most: every one of them must raise rather than return a plausible number.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from pipelines.parsers.inr_amounts import (
    CRORE,
    LAKH,
    LAKH_CRORE,
    NOT_REPORTED,
    RUPEE,
    THOUSAND,
    AmbiguousAmountError,
    AmountParseError,
    is_reported,
    parse_amount_cr,
    parse_amount_series,
    parse_unit_hint,
    sum_reported,
)


class TestExplicitUnits:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("₹1,23,456.78 crore", Decimal("123456.78")),
            ("Rs. 1234 cr", Decimal("1234")),
            ("Rs 1234 crore", Decimal("1234")),
            ("INR 1,000 crores", Decimal("1000")),
            ("₹ 48,20,512 crore", Decimal("4820512")),
            ("1234 cr.", Decimal("1234")),
            ("12,345 lakh", Decimal("123.45")),
            ("12,345 lakhs", Decimal("123.45")),
            ("500 lac", Decimal("5")),
            ("1.2 lakh crore", Decimal("120000")),
            ("1.2 lakh crores", Decimal("120000")),
            ("50.65 lakh crore", Decimal("5065000")),
            ("2 thousand crore", Decimal("2000")),
            ("₹1,234 crore rupees", Decimal("1234")),
            ("10 million", Decimal("1")),
            ("1 billion", Decimal("100")),
        ],
    )
    def test_parses_stated_units(self, raw: str, expected: Decimal) -> None:
        assert parse_amount_cr(raw) == expected

    def test_lakh_crore_beats_lakh_and_crore(self) -> None:
        """The compound unit has to win, or a 1.2 lakh crore budget becomes 1.2 crore."""
        assert parse_amount_cr("1.2 lakh crore") == Decimal("120000")
        assert parse_amount_cr("1.2 lakh") == Decimal("0.012")
        assert parse_amount_cr("1.2 crore") == Decimal("1.2")

    def test_indian_digit_grouping(self) -> None:
        assert parse_amount_cr("1,23,45,678 crore") == Decimal("12345678")

    def test_rupee_unit(self) -> None:
        assert parse_amount_cr("1,00,00,000 rupees") == Decimal("1")


class TestUnitHints:
    def test_hint_supplies_the_missing_unit(self) -> None:
        assert parse_amount_cr("1234", unit_hint=CRORE) == Decimal("1234")
        assert parse_amount_cr("1234", unit_hint=LAKH) == Decimal("12.34")
        assert parse_amount_cr("10000000", unit_hint=RUPEE) == Decimal("1")
        assert parse_amount_cr("10000", unit_hint=THOUSAND) == Decimal("1")

    def test_inline_unit_overrides_the_hint(self) -> None:
        """A table headed 'in crore' that spells out lakh crore means lakh crore."""
        assert parse_amount_cr("1.2 lakh crore", unit_hint=CRORE) == Decimal("120000")
        assert parse_amount_cr("500 lakh", unit_hint=CRORE) == Decimal("5")

    @pytest.mark.parametrize(
        ("header", "expected"),
        [
            ("(₹ in crore)", CRORE),
            ("Amount (Rs. in lakhs)", LAKH),
            ("Expenditure in ₹ crore", CRORE),
            ("Figures in lakh crore", LAKH_CRORE),
            ("Value (in rupees)", RUPEE),
            ("Actuals 2024-25", None),
            ("Ministry / Department", None),
            ("", None),
            (None, None),
        ],
    )
    def test_parse_unit_hint(self, header: str | None, expected: object) -> None:
        assert parse_unit_hint(header) is expected


class TestNegativeAndAccountingForms:
    def test_parentheses_are_negative(self) -> None:
        assert parse_amount_cr("(1,234)", unit_hint=CRORE) == Decimal("-1234")

    def test_parentheses_with_currency_and_unit(self) -> None:
        assert parse_amount_cr("(₹1,234.50 crore)") == Decimal("-1234.50")

    def test_leading_minus(self) -> None:
        assert parse_amount_cr("-1,234 crore") == Decimal("-1234")

    def test_negative_lakh_converts(self) -> None:
        assert parse_amount_cr("(2,500) lakh") == Decimal("-25")


class TestNotReported:
    @pytest.mark.parametrize(
        "raw",
        ["", " ", "-", "--", "—", "N/A", "NA", "n.a.", "Not reported", "Nil", "...", "*"],
    )
    def test_missing_cells_are_not_reported(self, raw: str) -> None:
        assert parse_amount_cr(raw) is NOT_REPORTED

    def test_none_is_not_reported(self) -> None:
        assert parse_amount_cr(None) is NOT_REPORTED

    def test_not_reported_is_not_zero(self) -> None:
        """Distinct from Decimal(0): the dashboard renders them differently."""
        assert parse_amount_cr("-") is not Decimal(0)
        assert not is_reported(parse_amount_cr("-"))

    def test_a_dash_is_not_read_as_a_negative_sign(self) -> None:
        assert parse_amount_cr("-") is NOT_REPORTED


class TestAmbiguityMustRaise:
    """Every case here would be a hundredfold error if the parser guessed."""

    def test_bare_number_without_hint_raises(self) -> None:
        with pytest.raises(AmbiguousAmountError):
            parse_amount_cr("1234")

    def test_bare_decimal_without_hint_raises(self) -> None:
        with pytest.raises(AmbiguousAmountError):
            parse_amount_cr("1,23,456.78")

    def test_currency_marker_alone_is_not_a_unit(self) -> None:
        """'Rs.' says the number is money. It does not say lakh or crore."""
        with pytest.raises(AmbiguousAmountError):
            parse_amount_cr("Rs. 1234")
        with pytest.raises(AmbiguousAmountError):
            parse_amount_cr("₹1,23,456.78")

    def test_numeric_input_without_hint_raises(self) -> None:
        with pytest.raises(AmbiguousAmountError):
            parse_amount_cr(1234)
        with pytest.raises(AmbiguousAmountError):
            parse_amount_cr(Decimal("1234"))

    def test_parenthesised_bare_number_raises(self) -> None:
        with pytest.raises(AmbiguousAmountError):
            parse_amount_cr("(1,234)")

    def test_zero_is_not_ambiguous(self) -> None:
        """Zero of any unit is zero, so it needs no human."""
        assert parse_amount_cr("0") == Decimal(0)
        assert parse_amount_cr("0.00") == Decimal(0)

    def test_error_carries_the_raw_text(self) -> None:
        with pytest.raises(AmbiguousAmountError) as caught:
            parse_amount_cr("4,832 ")
        assert caught.value.raw == "4,832 "

    def test_ambiguous_is_a_parse_error(self) -> None:
        assert issubclass(AmbiguousAmountError, AmountParseError)


class TestRejections:
    def test_percentage_is_not_an_amount(self) -> None:
        with pytest.raises(AmountParseError):
            parse_amount_cr("12.5%")

    def test_prose_is_not_an_amount(self) -> None:
        with pytest.raises(AmountParseError):
            parse_amount_cr("Ministry of Defence")

    def test_unknown_unit_word_raises(self) -> None:
        with pytest.raises(AmountParseError):
            parse_amount_cr("1234 tonnes")

    def test_two_magnitude_words_raise(self) -> None:
        with pytest.raises(AmountParseError):
            parse_amount_cr("1234 crore lakh extra")

    def test_float_input_is_refused(self) -> None:
        """Money is never a float in this system, not even at the boundary."""
        with pytest.raises(AmountParseError):
            parse_amount_cr(1234.56)

    def test_boolean_is_refused(self) -> None:
        with pytest.raises(AmountParseError):
            parse_amount_cr(True)


class TestSeries:
    def test_series_collects_failures_without_raising(self) -> None:
        values = ["1,000 crore", "-", "oops", "500 lakh"]
        results, failures = parse_amount_series(values)
        assert results[0] == Decimal("1000")
        assert results[1] is NOT_REPORTED
        assert results[2] is NOT_REPORTED
        assert results[3] == Decimal("5")
        assert [index for index, _, _ in failures] == [2]

    def test_series_uses_the_column_hint(self) -> None:
        results, failures = parse_amount_series(["100", "200", "-"], unit_hint=LAKH)
        assert failures == []
        assert results[:2] == [Decimal("1"), Decimal("2")]

    def test_series_without_hint_reports_every_bare_number(self) -> None:
        _, failures = parse_amount_series(["100", "200"])
        assert len(failures) == 2

    def test_sum_reported_counts_what_it_skipped(self) -> None:
        results, _ = parse_amount_series(["1,000 crore", "-", "500 lakh"])
        total, skipped = sum_reported(results)
        assert total == Decimal("1005")
        assert skipped == 1


class TestRealDocumentStrings:
    """Strings shaped like the ones these documents actually contain."""

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("₹ 50,65,345.00 crore", Decimal("5065345.00")),
            ("Rs.11,21,090 crore", Decimal("1121090")),
            ("6,58,822.00", Decimal("658822.00")),
            ("1,04,278", Decimal("104278")),
        ],
    )
    def test_budget_style_cells_with_a_crore_header(
        self, raw: str, expected: Decimal
    ) -> None:
        assert parse_amount_cr(raw, unit_hint=CRORE) == expected

    def test_non_breaking_spaces_survive_pdf_extraction(self) -> None:
        assert parse_amount_cr("₹ 1,234 crore") == Decimal("1234")

    def test_pfms_style_release_in_lakh(self) -> None:
        assert parse_amount_cr("2,34,567.89", unit_hint=LAKH) == Decimal("2345.6789")
