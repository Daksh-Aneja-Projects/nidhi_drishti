"""A3 rules: the deterministic core.

These are the tests that matter most for defensibility. A published flag is a
statement about a real ministry, and the only thing standing behind it is that
the rule fired exactly where it says it fires. So every rule is tested at its
threshold, just inside it, just outside it, and with its inputs missing.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from agents.a3_anomaly.rules import (
    MARCH_RUSH_MARCH_SHARE,
    MARCH_RUSH_Q4_SHARE,
    OVER_BURN_MIN_FY_ELAPSED,
    OVER_BURN_RATIO,
    REVISION_SWING,
    SPEND_NO_TENDER_MIN_RELEASE_CR,
    STAT_OUTLIER_MIN_HISTORY,
    UNDER_UTILIZATION_BURN,
    UNDER_UTILIZATION_MIN_FY_ELAPSED,
    Measures,
    evaluate,
    rule_descriptions,
    rule_march_rush,
    rule_over_burn,
    rule_revision_swing,
    rule_spend_no_tender,
    rule_stat_outlier,
    rule_under_utilization,
)


def measures(**overrides) -> Measures:
    base: dict = {
        "entity_type": "ministry",
        "entity_id": "min-fixture",
        "entity_label": "Ministry of Fixture",
        "fy": "FY2026",
    }
    return Measures(**{**base, **overrides})


def full_year(monthly: dict[int, str]) -> dict[int, Decimal]:
    return {index: Decimal(value) for index, value in monthly.items()}


# ---------------------------------------------------------------------------
# under_utilization
# ---------------------------------------------------------------------------


def test_under_utilization_fires_below_the_burn_threshold() -> None:
    hit = rule_under_utilization(
        measures(
            burn_ratio=Decimal("0.40"),
            pct_fy_elapsed=Decimal("0.75"),
            expenditure_to_date=Decimal("3000"),
            current_authority=Decimal("10000"),
            expenditure_as_of=date(2025, 12, 31),
        )
    )
    assert hit is not None
    assert hit.rule_id == "under_utilization"
    assert hit.severity == "notable"
    assert hit.metric["burn_ratio"] == "0.40"
    assert hit.does_not_show


def test_under_utilization_is_high_when_very_low() -> None:
    hit = rule_under_utilization(
        measures(burn_ratio=Decimal("0.20"), pct_fy_elapsed=Decimal("0.75"))
    )
    assert hit is not None and hit.severity == "high"


def test_under_utilization_does_not_fire_at_the_threshold() -> None:
    """Strictly below. A ratio of exactly 0.5 is on the documented line, not past it."""
    assert (
        rule_under_utilization(
            measures(burn_ratio=UNDER_UTILIZATION_BURN, pct_fy_elapsed=Decimal("0.75"))
        )
        is None
    )


def test_under_utilization_waits_until_half_the_year_has_passed() -> None:
    """Early in the year every entity looks behind, and flagging them all says nothing."""
    assert (
        rule_under_utilization(
            measures(burn_ratio=Decimal("0.1"), pct_fy_elapsed=UNDER_UTILIZATION_MIN_FY_ELAPSED)
        )
        is None
    )


def test_under_utilization_needs_both_inputs() -> None:
    assert rule_under_utilization(measures(pct_fy_elapsed=Decimal("0.9"))) is None
    assert rule_under_utilization(measures(burn_ratio=Decimal("0.1"))) is None


# ---------------------------------------------------------------------------
# over_burn
# ---------------------------------------------------------------------------


def test_over_burn_fires_above_the_ratio() -> None:
    hit = rule_over_burn(measures(burn_ratio=Decimal("1.45"), pct_fy_elapsed=Decimal("0.6")))
    assert hit is not None
    assert hit.severity == "notable"


def test_over_burn_high_band() -> None:
    hit = rule_over_burn(measures(burn_ratio=Decimal("1.9"), pct_fy_elapsed=Decimal("0.6")))
    assert hit is not None and hit.severity == "high"


def test_over_burn_does_not_fire_at_the_threshold() -> None:
    assert (
        rule_over_burn(measures(burn_ratio=OVER_BURN_RATIO, pct_fy_elapsed=Decimal("0.6"))) is None
    )


def test_over_burn_ignores_the_first_quarter() -> None:
    """A small absolute overspend in April produces an enormous, meaningless ratio."""
    assert (
        rule_over_burn(
            measures(
                burn_ratio=Decimal("4.0"), pct_fy_elapsed=OVER_BURN_MIN_FY_ELAPSED - Decimal("0.01")
            )
        )
        is None
    )


# ---------------------------------------------------------------------------
# march_rush
# ---------------------------------------------------------------------------


def test_march_rush_fires_on_a_q4_concentration() -> None:
    monthly = full_year({i: "50" for i in range(1, 10)} | {10: "150", 11: "150", 12: "150"})
    hit = rule_march_rush(measures(monthly_amounts=monthly, months_reported=12))
    assert hit is not None
    assert Decimal(hit.metric["q4_share"]) > MARCH_RUSH_Q4_SHARE


def test_march_rush_fires_on_march_alone() -> None:
    monthly = full_year({i: "100" for i in range(1, 12)} | {12: "300"})
    hit = rule_march_rush(measures(monthly_amounts=monthly, months_reported=12))
    assert hit is not None
    assert Decimal(hit.metric["march_share"]) > MARCH_RUSH_MARCH_SHARE


def test_march_rush_is_silent_on_an_even_year() -> None:
    monthly = full_year({i: "100" for i in range(1, 13)})
    assert rule_march_rush(measures(monthly_amounts=monthly, months_reported=12)) is None


def test_march_rush_needs_a_complete_year() -> None:
    """A part year has no fourth quarter to concentrate in."""
    monthly = full_year({10: "150", 11: "150", 12: "150"})
    assert rule_march_rush(measures(monthly_amounts=monthly, months_reported=3)) is None


def test_march_rush_severity_escalates() -> None:
    monthly = full_year({i: "10" for i in range(1, 12)} | {12: "400"})
    hit = rule_march_rush(measures(monthly_amounts=monthly, months_reported=12))
    assert hit is not None and hit.severity == "high"


# ---------------------------------------------------------------------------
# revision_swing
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("be", "re", "expected_severity"),
    [
        ("1000", "1300", "notable"),
        ("1000", "700", "notable"),
        ("1000", "1600", "high"),
        ("1000", "400", "high"),
    ],
)
def test_revision_swing_fires_both_directions(be, re, expected_severity) -> None:
    hit = rule_revision_swing(measures(be=Decimal(be), re=Decimal(re)))
    assert hit is not None
    assert hit.severity == expected_severity


def test_revision_swing_does_not_fire_at_the_threshold() -> None:
    be = Decimal("1000")
    re = be * (1 + REVISION_SWING)
    assert rule_revision_swing(measures(be=be, re=re)) is None


def test_revision_swing_needs_both_estimates() -> None:
    assert rule_revision_swing(measures(be=Decimal("1000"))) is None
    assert rule_revision_swing(measures(re=Decimal("1000"))) is None
    assert rule_revision_swing(measures(be=Decimal("0"), re=Decimal("500"))) is None


def test_revision_swing_records_direction() -> None:
    hit = rule_revision_swing(measures(be=Decimal("1000"), re=Decimal("500")))
    assert hit is not None and hit.metric["direction"] == "below"


# ---------------------------------------------------------------------------
# spend_no_tender
# ---------------------------------------------------------------------------


def capital_heavy(**overrides) -> Measures:
    base = {
        "released": Decimal("500"),
        "expenditure_to_date": Decimal("500"),
        "capital_expenditure": Decimal("400"),
        "tender_count_trailing_90d": 0,
    }
    return measures(**{**base, **overrides})


def test_spend_no_tender_is_always_informational() -> None:
    """Tier 2 signal. docs/05 caps it at info, whatever the numbers look like."""
    hit = rule_spend_no_tender(capital_heavy())
    assert hit is not None
    assert hit.severity == "info"
    assert "does not show that procurement did not happen" in hit.does_not_show


def test_spend_no_tender_is_silent_when_tenders_exist() -> None:
    assert rule_spend_no_tender(capital_heavy(tender_count_trailing_90d=2)) is None


def test_spend_no_tender_is_silent_below_the_release_floor() -> None:
    assert (
        rule_spend_no_tender(
            capital_heavy(
                released=SPEND_NO_TENDER_MIN_RELEASE_CR - Decimal("1"),
                expenditure_to_date=Decimal("99"),
                capital_expenditure=Decimal("80"),
            )
        )
        is None
    )


def test_spend_no_tender_is_silent_for_a_revenue_heavy_entity() -> None:
    """A pensions or salaries line does not procure, so an absence proves nothing."""
    assert rule_spend_no_tender(capital_heavy(capital_expenditure=Decimal("10"))) is None


def test_spend_no_tender_needs_tender_data_at_all() -> None:
    assert rule_spend_no_tender(capital_heavy(tender_count_trailing_90d=None)) is None


# ---------------------------------------------------------------------------
# stat_outlier
# ---------------------------------------------------------------------------


def test_stat_outlier_fires_on_a_large_deviation() -> None:
    hit = rule_stat_outlier(
        measures(
            monthly_amounts={9: Decimal("900")},
            monthly_history={9: [Decimal("100"), Decimal("110"), Decimal("90")]},
            latest_month_index=9,
        )
    )
    assert hit is not None
    assert hit.rule_id == "stat_outlier"
    assert Decimal(hit.metric["z_score"]) > 0


def test_stat_outlier_needs_three_years_of_history() -> None:
    """docs/05 requires at least three prior years before the statistic exists."""
    history = [Decimal("100"), Decimal("110")]
    assert len(history) < STAT_OUTLIER_MIN_HISTORY
    assert (
        rule_stat_outlier(
            measures(
                monthly_amounts={9: Decimal("900")},
                monthly_history={9: history},
                latest_month_index=9,
            )
        )
        is None
    )


def test_stat_outlier_ignores_a_flat_series() -> None:
    """A near-zero standard deviation makes any deviation look infinite."""
    assert (
        rule_stat_outlier(
            measures(
                monthly_amounts={9: Decimal("100.5")},
                monthly_history={9: [Decimal("100"), Decimal("100"), Decimal("100")]},
                latest_month_index=9,
            )
        )
        is None
    )


def test_stat_outlier_is_silent_on_an_ordinary_month() -> None:
    assert (
        rule_stat_outlier(
            measures(
                monthly_amounts={9: Decimal("105")},
                monthly_history={9: [Decimal("100"), Decimal("110"), Decimal("90")]},
                latest_month_index=9,
            )
        )
        is None
    )


# ---------------------------------------------------------------------------
# evaluate()
# ---------------------------------------------------------------------------


def test_evaluate_is_deterministic_and_can_return_several_flags() -> None:
    m = measures(
        be=Decimal("1000"),
        re=Decimal("1400"),
        burn_ratio=Decimal("0.3"),
        pct_fy_elapsed=Decimal("0.8"),
        expenditure_to_date=Decimal("300"),
        current_authority=Decimal("1400"),
    )
    first = evaluate(m)
    second = evaluate(m)
    assert [h.rule_id for h in first] == [h.rule_id for h in second]
    assert {"under_utilization", "revision_swing"} <= {h.rule_id for h in first}


def test_evaluate_returns_nothing_for_an_unremarkable_entity() -> None:
    assert (
        evaluate(
            measures(
                be=Decimal("1000"),
                re=Decimal("1050"),
                burn_ratio=Decimal("1.02"),
                pct_fy_elapsed=Decimal("0.7"),
                monthly_amounts=full_year({i: "100" for i in range(1, 13)}),
                months_reported=12,
            )
        )
        == []
    )


def test_evaluate_returns_nothing_when_everything_is_missing() -> None:
    """Absent data is not a finding. Silence is the honest output."""
    assert evaluate(measures()) == []


def test_every_rule_id_has_a_published_description() -> None:
    descriptions = rule_descriptions()
    assert set(descriptions) == {
        "march_rush",
        "under_utilization",
        "over_burn",
        "spend_no_tender",
        "revision_swing",
        "stat_outlier",
    }
    assert all(text for text in descriptions.values())


def test_metric_always_carries_the_limitation_line() -> None:
    hit = rule_under_utilization(measures(burn_ratio=Decimal("0.2"), pct_fy_elapsed=Decimal("0.9")))
    assert hit is not None
    assert hit.metric_with_limits()["does_not_show"]
