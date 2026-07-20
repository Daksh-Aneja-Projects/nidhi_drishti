"""Number extraction and Indian display formatting."""

from __future__ import annotations

from decimal import Decimal

import pytest

from agents.lib.format import NOT_REPORTED, crore, indian_group, percent, ratio
from agents.lib.numbers import (
    collect_allowed_values,
    extract_numbers,
    strip_non_quantities,
    unsupported_numbers,
)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (Decimal("1234567"), "12,34,567"),
        (Decimal("123456"), "1,23,456"),
        (Decimal("1000"), "1,000"),
        (Decimal("999"), "999"),
        (Decimal("50650000"), "5,06,50,000"),
        (Decimal("-1234567"), "-12,34,567"),
        (Decimal("1234.5"), "1,234.5"),
        (Decimal("0"), "0"),
    ],
)
def test_indian_digit_grouping(value, expected) -> None:
    assert indian_group(value) == expected


def test_missing_money_is_never_zero() -> None:
    assert crore(None) == NOT_REPORTED
    assert percent(None) == NOT_REPORTED
    assert ratio(None) == NOT_REPORTED
    assert crore(Decimal("0")) == "₹0 cr"


def test_crore_rendering() -> None:
    assert crore(Decimal("123456.78")) == "₹1,23,456.78 cr"


def test_percent_and_ratio_rounding() -> None:
    assert percent(Decimal("43.349")) == "43.3%"
    assert ratio(Decimal("1.2349")) == "1.23"


def test_extraction_ignores_identifiers_and_dates() -> None:
    text = "In FY2026 the figure [source:412] on 2025-11-30 and in Q4 was 9,100.00 INR crore."
    cleaned = strip_non_quantities(text)
    assert "FY2026" not in cleaned
    assert "source:412" not in cleaned
    assert "2025-11-30" not in cleaned
    assert [m.raw for m in extract_numbers(text)] == ["9,100.00"]


def test_extraction_keeps_decimal_precision() -> None:
    mention = extract_numbers("The ratio was 0.40 this period.")[0]
    assert mention.value == Decimal("0.40")
    assert mention.decimals == 2


def test_unsupported_numbers_matches_at_the_printed_precision() -> None:
    allowed = {Decimal("40500.40")}
    assert unsupported_numbers("The figure was 40,500 crore.", allowed) == []
    assert unsupported_numbers("The figure was 40,500.40 crore.", allowed) == []
    assert [m.raw for m in unsupported_numbers("The figure was 45,000.40 crore.", allowed)] == [
        "45,000.40"
    ]


def test_unsupported_numbers_reports_context() -> None:
    problems = unsupported_numbers("Releases reached 8,888.00 crore in the period.", {Decimal(1)})
    assert problems
    assert "Releases reached" in problems[0].context


def test_collect_allowed_values_walks_nested_structures() -> None:
    payload = {
        "burn_ratio": "0.40",
        "nested": {"amounts": ["3000", 10000]},
        "flag": True,
        "missing": None,
    }
    values = collect_allowed_values(payload)
    assert Decimal("0.40") in values
    assert Decimal("3000") in values
    assert Decimal("10000") in values
    # A boolean is not a quantity, and must not become Decimal(1).
    assert Decimal(1) not in values
