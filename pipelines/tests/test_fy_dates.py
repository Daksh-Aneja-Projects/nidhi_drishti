"""Fiscal-year tests. Required by CLAUDE.md.

The boundary that matters is 31 March / 1 April. Every off-by-one in Indian
fiscal code lives there, and getting it wrong moves a year of spending into the
wrong bucket. These cases mirror packages/core/src/fy.test.ts so the three
implementations cannot drift apart quietly.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from pipelines.parsers.fy_dates import (
    FiscalYearError,
    PeriodLabelError,
    decumulate,
    format_fy_long,
    fy_bounds,
    fy_end,
    fy_fraction_elapsed,
    fy_from_indian_label,
    fy_month_index,
    fy_months,
    fy_of,
    fy_quarter,
    fy_quarter_bounds,
    fy_start,
    is_fy,
    is_within_fy,
    month_from_fy_index,
    month_label,
    next_fy,
    parse_fy,
    parse_month_label,
    previous_fy,
    recent_fys,
)


class TestFiscalYearBounds:
    def test_fy2026_runs_april_2025_to_march_2026(self) -> None:
        assert fy_start("FY2026") == date(2025, 4, 1)
        assert fy_end("FY2026") == date(2026, 3, 31)
        assert fy_bounds("FY2026") == (date(2025, 4, 1), date(2026, 3, 31))

    def test_parse_fy(self) -> None:
        assert parse_fy("FY2026") == 2026

    @pytest.mark.parametrize("value", ["2026", "FY26", "fy2026", "", "FY20260", "FY-100"])
    def test_malformed_labels_raise(self, value: str) -> None:
        with pytest.raises(FiscalYearError):
            parse_fy(value)
        assert not is_fy(value)

    def test_out_of_range_years_raise(self) -> None:
        with pytest.raises(FiscalYearError):
            parse_fy("FY1900")

    def test_neighbours(self) -> None:
        assert previous_fy("FY2026") == "FY2025"
        assert next_fy("FY2026") == "FY2027"
        assert recent_fys("FY2026", 3) == ["FY2024", "FY2025", "FY2026"]

    def test_long_format_has_no_em_dash(self) -> None:
        label = format_fy_long("FY2026")
        assert label == "FY2026 (Apr 2025 to Mar 2026)"
        assert "—" not in label and "–" not in label


class TestTheMarchAprilBoundary:
    """The one boundary that matters."""

    def test_31_march_and_1_april_are_different_fiscal_years(self) -> None:
        assert fy_of(date(2025, 3, 31)) == "FY2025"
        assert fy_of(date(2025, 4, 1)) == "FY2026"

    def test_last_day_of_the_fy(self) -> None:
        assert fy_of(date(2026, 3, 31)) == "FY2026"
        assert fy_of(date(2026, 4, 1)) == "FY2027"

    def test_january_belongs_to_the_fy_labelled_with_its_own_year(self) -> None:
        assert fy_of(date(2026, 1, 15)) == "FY2026"

    def test_december_belongs_to_the_next_labelled_year(self) -> None:
        assert fy_of(date(2025, 12, 31)) == "FY2026"

    def test_containment_is_inclusive_at_both_ends(self) -> None:
        assert is_within_fy(date(2025, 4, 1), "FY2026")
        assert is_within_fy(date(2026, 3, 31), "FY2026")
        assert not is_within_fy(date(2025, 3, 31), "FY2026")
        assert not is_within_fy(date(2026, 4, 1), "FY2026")


class TestQuarters:
    @pytest.mark.parametrize(
        ("day", "quarter"),
        [
            (date(2025, 4, 1), 1),
            (date(2025, 6, 30), 1),
            (date(2025, 7, 1), 2),
            (date(2025, 9, 30), 2),
            (date(2025, 10, 1), 3),
            (date(2025, 12, 31), 3),
            (date(2026, 1, 1), 4),
            (date(2026, 3, 31), 4),
        ],
    )
    def test_q1_starts_in_april(self, day: date, quarter: int) -> None:
        assert fy_quarter(day) == quarter

    def test_quarter_bounds(self) -> None:
        assert fy_quarter_bounds("FY2026", 1) == (date(2025, 4, 1), date(2025, 6, 30))
        assert fy_quarter_bounds("FY2026", 3) == (date(2025, 10, 1), date(2025, 12, 31))
        assert fy_quarter_bounds("FY2026", 4) == (date(2026, 1, 1), date(2026, 3, 31))

    def test_invalid_quarter_raises(self) -> None:
        with pytest.raises(FiscalYearError):
            fy_quarter_bounds("FY2026", 5)


class TestFiscalMonthIndex:
    def test_april_is_month_one_and_march_is_twelve(self) -> None:
        assert fy_month_index(date(2025, 4, 30)) == 1
        assert fy_month_index(date(2025, 11, 30)) == 8
        assert fy_month_index(date(2026, 1, 31)) == 10
        assert fy_month_index(date(2026, 3, 31)) == 12

    def test_month_from_index_round_trips(self) -> None:
        for index in range(1, 13):
            year, month = month_from_fy_index("FY2026", index)
            assert fy_month_index(date(year, month, 1)) == index

    def test_fy_months_start_in_april(self) -> None:
        months = fy_months("FY2026")
        assert months[0] == date(2025, 4, 1)
        assert months[-1] == date(2026, 3, 1)
        assert len(months) == 12

    def test_month_label(self) -> None:
        assert month_label(date(2025, 4, 1)) == "Apr 2025"


class TestFractionElapsed:
    def test_first_day_counts_as_one_day(self) -> None:
        fraction = fy_fraction_elapsed("FY2026", date(2025, 4, 1))
        assert fraction == Decimal(1) / Decimal(365)

    def test_last_day_is_fully_elapsed(self) -> None:
        assert fy_fraction_elapsed("FY2026", date(2026, 3, 31)) == Decimal(1)

    def test_before_the_start_is_zero(self) -> None:
        assert fy_fraction_elapsed("FY2026", date(2025, 3, 31)) == Decimal(0)

    def test_after_the_end_is_one(self) -> None:
        assert fy_fraction_elapsed("FY2026", date(2027, 1, 1)) == Decimal(1)

    def test_leap_day_is_counted(self) -> None:
        """FY2024 contains 29 February 2024, so it has 366 days."""
        assert fy_fraction_elapsed("FY2024", date(2023, 4, 1)) == Decimal(1) / Decimal(366)

    def test_half_way(self) -> None:
        fraction = fy_fraction_elapsed("FY2026", date(2025, 9, 30))
        assert Decimal("0.49") < fraction < Decimal("0.51")


class TestIndianFiscalYearLabels:
    @pytest.mark.parametrize(
        ("label", "expected"),
        [
            ("2025-26", "FY2026"),
            ("2025-2026", "FY2026"),
            ("2024-25", "FY2025"),
            ("1999-00", "FY2000"),
            ("FY2026", "FY2026"),
            ("2025 26", "FY2026"),
        ],
    )
    def test_conversion(self, label: str, expected: str) -> None:
        assert fy_from_indian_label(label) == expected

    @pytest.mark.parametrize("label", ["2025-27", "2025", "not a year", ""])
    def test_bad_labels_raise(self, label: str) -> None:
        with pytest.raises(PeriodLabelError):
            fy_from_indian_label(label)


class TestMonthLabelParsing:
    def test_single_month_is_not_cumulative(self) -> None:
        period = parse_month_label("April 2025")
        assert period.period_start == date(2025, 4, 1)
        assert period.period_end == date(2025, 4, 30)
        assert period.fy == "FY2026"
        assert period.is_cumulative is False
        assert period.fiscal_month_index == 1

    def test_short_month_name(self) -> None:
        period = parse_month_label("Apr 2025")
        assert period.period_end == date(2025, 4, 30)

    def test_cumulative_range_is_flagged(self) -> None:
        """The flag that stops eight snapshots becoming four years of spending."""
        period = parse_month_label("April-November 2025")
        assert period.period_start == date(2025, 4, 1)
        assert period.period_end == date(2025, 11, 30)
        assert period.is_cumulative is True
        assert period.fy == "FY2026"
        assert period.months_covered == 8
        assert period.fiscal_month_index == 8

    def test_range_with_the_word_to(self) -> None:
        period = parse_month_label("April to November 2025")
        assert period.period_end == date(2025, 11, 30)
        assert period.is_cumulative is True

    def test_october_is_not_split_on_the_letters_to(self) -> None:
        """'October' contains 'to'. A loose separator turns it into two months."""
        period = parse_month_label("October 2025")
        assert period.period_start == date(2025, 10, 1)
        assert period.is_cumulative is False

    def test_range_crossing_the_new_year(self) -> None:
        period = parse_month_label("April-January 2026")
        assert period.period_start == date(2025, 4, 1)
        assert period.period_end == date(2026, 1, 31)
        assert period.fy == "FY2026"
        assert period.is_cumulative is True

    def test_range_with_two_explicit_years(self) -> None:
        period = parse_month_label("April 2025 to January 2026")
        assert period.period_start == date(2025, 4, 1)
        assert period.period_end == date(2026, 1, 31)

    def test_full_year_range_with_indian_label(self) -> None:
        period = parse_month_label("April-March 2025-26")
        assert period.period_start == date(2025, 4, 1)
        assert period.period_end == date(2026, 3, 31)
        assert period.fy == "FY2026"
        assert period.months_covered == 12

    def test_march_alone_lands_in_the_year_it_ends(self) -> None:
        period = parse_month_label("March 2026")
        assert period.fy == "FY2026"
        assert period.fiscal_month_index == 12

    @pytest.mark.parametrize(
        "label",
        ["April", "", "Aprol 2025", "2025", "Movember 2025"],
    )
    def test_unreadable_labels_raise(self, label: str) -> None:
        with pytest.raises(PeriodLabelError):
            parse_month_label(label)

    def test_a_range_spanning_two_fiscal_years_raises(self) -> None:
        with pytest.raises(PeriodLabelError):
            parse_month_label("January 2025 to July 2025")


class TestDecumulation:
    """The invariant from docs/04 section 3."""

    def test_monthly_is_the_difference_of_successive_cumulatives(self) -> None:
        series = [
            (date(2025, 4, 30), Decimal("100")),
            (date(2025, 5, 31), Decimal("250")),
            (date(2025, 6, 30), Decimal("400")),
        ]
        deltas = decumulate(series)
        assert [delta.monthly for delta in deltas] == [
            Decimal("100"),
            Decimal("150"),
            Decimal("150"),
        ]

    def test_april_is_its_own_monthly_figure(self) -> None:
        deltas = decumulate([(date(2025, 4, 30), Decimal("100"))])
        assert deltas[0].monthly == Decimal("100")
        assert deltas[0].fiscal_month_index == 1

    def test_negative_deltas_are_kept_and_flagged_not_clamped(self) -> None:
        """A revision must stay visible. Clamping inflates the annual total."""
        series = [
            (date(2025, 4, 30), Decimal("100")),
            (date(2025, 5, 31), Decimal("90")),
        ]
        deltas = decumulate(series)
        assert deltas[1].monthly == Decimal("-10")
        assert deltas[1].is_revision_artifact is True

    def test_a_gap_makes_the_next_month_unrecoverable(self) -> None:
        series = [
            (date(2025, 4, 30), Decimal("100")),
            (date(2025, 6, 30), Decimal("400")),
        ]
        deltas = decumulate(series)
        assert deltas[1].monthly is None, "two months of spend must not land on one bar"

    def test_a_series_that_does_not_start_in_april_has_no_first_delta(self) -> None:
        deltas = decumulate([(date(2025, 5, 31), Decimal("250"))])
        assert deltas[0].monthly is None

    def test_input_order_does_not_matter(self) -> None:
        series = [
            (date(2025, 6, 30), Decimal("400")),
            (date(2025, 4, 30), Decimal("100")),
            (date(2025, 5, 31), Decimal("250")),
        ]
        deltas = decumulate(series)
        assert [delta.fiscal_month_index for delta in deltas] == [1, 2, 3]

    def test_monthly_deltas_sum_back_to_the_final_cumulative(self) -> None:
        series = [
            (date(2025, 4, 30), Decimal("1200.50")),
            (date(2025, 5, 31), Decimal("2500.75")),
            (date(2025, 6, 30), Decimal("3900.25")),
            (date(2025, 7, 31), Decimal("5100.00")),
        ]
        deltas = decumulate(series)
        total = sum((d.monthly for d in deltas if d.monthly is not None), Decimal(0))
        assert total == Decimal("5100.00")

    def test_mixing_fiscal_years_raises(self) -> None:
        with pytest.raises(ValueError, match="single fiscal year"):
            decumulate(
                [
                    (date(2025, 4, 30), Decimal("100")),
                    (date(2026, 4, 30), Decimal("120")),
                ]
            )

    def test_empty_series(self) -> None:
        assert decumulate([]) == []
