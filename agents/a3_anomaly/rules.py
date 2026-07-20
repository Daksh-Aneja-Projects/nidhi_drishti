"""A3 - the anomaly rules. Deterministic, and deliberately not a model's job.

docs/05 A3 is explicit: rules decide whether a flag exists, the model only writes
the prose. So the decision lives here, in pure functions over a measurement
record, with every threshold a named constant. No network, no model, no
randomness. Given the same measures this module returns the same flags forever,
which is what makes a published flag defensible.

The measures themselves come from :mod:`agents.a3_anomaly.queries`, which
aggregates the materialised views. The split matters: SQL does arithmetic on
rows, Python applies thresholds, and the thresholds are therefore unit-testable
without a database.

Every rule also carries a plain-English ``description`` and a
``does_not_show`` line. docs/08 section 2 requires every anomaly card to say what
it does not prove, and the safest place for that sentence is next to the rule
that produced the card, not in a template somebody may forget to fill in.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any, Literal

RuleId = Literal[
    "march_rush",
    "under_utilization",
    "over_burn",
    "spend_no_tender",
    "revision_swing",
    "stat_outlier",
]
Severity = Literal["info", "notable", "high"]
EntityType = Literal["ministry", "scheme", "national"]

# ---------------------------------------------------------------------------
# Thresholds. Each appears exactly once in the codebase.
# ---------------------------------------------------------------------------

#: march_rush: share of the year's reported spend falling in Q4 (Jan to Mar).
MARCH_RUSH_Q4_SHARE = Decimal("0.30")
MARCH_RUSH_Q4_SHARE_HIGH = Decimal("0.45")
#: march_rush: share falling in March alone. One twelfth of a year is 0.083, so
#: 0.15 is close to double the even-pace expectation.
MARCH_RUSH_MARCH_SHARE = Decimal("0.15")
MARCH_RUSH_MARCH_SHARE_HIGH = Decimal("0.25")

#: under_utilization: burn ratio below this, once at least half the year has
#: elapsed. Burn ratio is spend-fraction divided by year-fraction, so 1.0 is
#: exactly on pace and 0.5 is half pace.
UNDER_UTILIZATION_BURN = Decimal("0.5")
UNDER_UTILIZATION_BURN_HIGH = Decimal("0.25")
UNDER_UTILIZATION_MIN_FY_ELAPSED = Decimal("0.5")

#: over_burn: spending faster than the authority to spend implies.
OVER_BURN_RATIO = Decimal("1.3")
OVER_BURN_RATIO_HIGH = Decimal("1.6")
#: Early in the year a small absolute overspend produces an enormous ratio, so
#: the rule waits until the year is far enough along for the ratio to mean
#: something.
OVER_BURN_MIN_FY_ELAPSED = Decimal("0.25")

#: revision_swing: |RE - BE| / BE.
REVISION_SWING = Decimal("0.25")
REVISION_SWING_HIGH = Decimal("0.50")

#: spend_no_tender: trailing window and the release floor below which an absence
#: of tenders says nothing at all.
SPEND_NO_TENDER_WINDOW_DAYS = 90
SPEND_NO_TENDER_MIN_RELEASE_CR = Decimal("100")
#: Capital share of expenditure above which procurement is the expected route.
SPEND_NO_TENDER_CAPITAL_SHARE = Decimal("0.30")

#: stat_outlier: absolute z-score of this month against the same month in prior
#: years, and the minimum history docs/05 requires before the statistic exists.
STAT_OUTLIER_Z = Decimal("2.5")
STAT_OUTLIER_Z_HIGH = Decimal("3.5")
STAT_OUTLIER_MIN_HISTORY = 3
#: A near-zero standard deviation makes any deviation look infinite, so a series
#: this flat is treated as having no usable variance.
STAT_OUTLIER_MIN_STDEV_CR = Decimal("1")

#: Every flag is written pending, including the informational ones. docs/05
#: requires human approval for notable and high; extending it to info costs a
#: click and removes the class of bug where a severity is miscomputed and an
#: unreviewed card goes public.
INITIAL_STATUS = "pending"


@dataclass(frozen=True, slots=True)
class Measures:
    """Everything the rules need about one entity in one fiscal year.

    Every field is optional because government sources are incomplete by
    default. A rule whose inputs are missing does not fire; it does not fall
    back to a default and it does not treat absent as zero.
    """

    entity_type: EntityType
    entity_id: str
    entity_label: str
    fy: str

    be: Decimal | None = None
    re: Decimal | None = None
    supplementary: Decimal | None = None
    current_authority: Decimal | None = None

    expenditure_to_date: Decimal | None = None
    expenditure_as_of: date | None = None
    #: Fraction of the FY elapsed at ``expenditure_as_of``, in 0..1. Measured at
    #: the date the figure covers, not today: central accounts run about two
    #: months behind and comparing June's spend against November's calendar
    #: would show the entire government as behind schedule.
    pct_fy_elapsed: Decimal | None = None
    burn_ratio: Decimal | None = None

    capital_expenditure: Decimal | None = None
    released: Decimal | None = None

    #: De-cumulated monthly spend for this FY, keyed by fiscal month index
    #: (April = 1 .. March = 12). Missing months are simply absent.
    monthly_amounts: dict[int, Decimal] = field(default_factory=dict)
    #: Number of distinct months reported. A partial year cannot be tested for a
    #: March concentration.
    months_reported: int = 0

    #: Same-month spend in prior fiscal years, for the statistical rule.
    #: {fiscal_month_index: [amount in FY-1, amount in FY-2, ...]}
    monthly_history: dict[int, list[Decimal]] = field(default_factory=dict)
    #: The month the statistical rule should test, usually the latest reported.
    latest_month_index: int | None = None

    tender_count_trailing_90d: int | None = None

    def q4_amount(self) -> Decimal | None:
        """Spend in fiscal Q4, which is January, February and March."""
        months = [self.monthly_amounts.get(i) for i in (10, 11, 12)]
        if any(month is None for month in months):
            # A missing month means the quarter cannot be totalled. It is not
            # zero, and summing what is present would understate the quarter.
            return None
        return sum((month for month in months if month is not None), Decimal(0))

    def fy_reported_total(self) -> Decimal | None:
        if not self.monthly_amounts:
            return None
        return sum(self.monthly_amounts.values(), Decimal(0))

    def capital_share(self) -> Decimal | None:
        if self.capital_expenditure is None or not self.expenditure_to_date:
            return None
        if self.expenditure_to_date == 0:
            return None
        return self.capital_expenditure / self.expenditure_to_date


@dataclass(frozen=True, slots=True)
class RuleHit:
    """One flag a rule decided exists."""

    rule_id: RuleId
    severity: Severity
    #: The numbers behind the decision, stored verbatim in ``anomaly_flag.metric``.
    #: These are the only figures the explanation model is allowed to state.
    metric: dict[str, Any]
    #: Plain-English statement of what the rule measured, handed to the model as
    #: context and stored so a reviewer can see the rule without reading code.
    description: str
    #: The mandatory "what this does not prove" line (docs/08 section 2).
    does_not_show: str

    def metric_with_limits(self) -> dict[str, Any]:
        return {**self.metric, "does_not_show": self.does_not_show}


def _pct(value: Decimal) -> str:
    return f"{(value * 100).quantize(Decimal('0.1'))} percent"


# ---------------------------------------------------------------------------
# The rules
# ---------------------------------------------------------------------------


def rule_march_rush(m: Measures) -> RuleHit | None:
    """More than 30 percent of the year's spend in Q4, or 15 percent in March.

    Only evaluated on a complete year. A part-year series has no Q4 to speak of,
    and flagging one would say more about the reporting calendar than about the
    spending.
    """
    if m.months_reported < 12:
        return None
    total = m.fy_reported_total()
    q4 = m.q4_amount()
    march = m.monthly_amounts.get(12)
    if total is None or total <= 0 or q4 is None or march is None:
        return None

    q4_share = q4 / total
    march_share = march / total
    if q4_share <= MARCH_RUSH_Q4_SHARE and march_share <= MARCH_RUSH_MARCH_SHARE:
        return None

    severity: Severity = (
        "high"
        if q4_share > MARCH_RUSH_Q4_SHARE_HIGH or march_share > MARCH_RUSH_MARCH_SHARE_HIGH
        else "notable"
    )
    return RuleHit(
        rule_id="march_rush",
        severity=severity,
        metric={
            "fy_reported_total_inr_cr": str(total),
            "q4_amount_inr_cr": str(q4),
            "march_amount_inr_cr": str(march),
            "q4_share": str(q4_share.quantize(Decimal("0.0001"))),
            "march_share": str(march_share.quantize(Decimal("0.0001"))),
            "q4_share_threshold": str(MARCH_RUSH_Q4_SHARE),
            "march_share_threshold": str(MARCH_RUSH_MARCH_SHARE),
            "months_reported": m.months_reported,
        },
        description=(
            f"{_pct(q4_share)} of the year's reported expenditure fell in the January to March "
            f"quarter and {_pct(march_share)} fell in March alone, against rule thresholds of "
            f"{_pct(MARCH_RUSH_Q4_SHARE)} and {_pct(MARCH_RUSH_MARCH_SHARE)}."
        ),
        does_not_show=(
            "This does not show that the spending was rushed or wasteful. Many programmes "
            "release funds against milestones or statutory dates that fall late in the year, "
            "and accounting entries are often booked in the closing month."
        ),
    )


def rule_under_utilization(m: Measures) -> RuleHit | None:
    """Burn ratio under 0.5 once more than half the year has elapsed."""
    if m.burn_ratio is None or m.pct_fy_elapsed is None:
        return None
    if m.pct_fy_elapsed <= UNDER_UTILIZATION_MIN_FY_ELAPSED:
        return None
    if m.burn_ratio >= UNDER_UTILIZATION_BURN:
        return None

    severity: Severity = "high" if m.burn_ratio < UNDER_UTILIZATION_BURN_HIGH else "notable"
    spent_share = (
        m.expenditure_to_date / m.current_authority
        if m.expenditure_to_date is not None and m.current_authority
        else None
    )
    return RuleHit(
        rule_id="under_utilization",
        severity=severity,
        metric={
            "burn_ratio": str(m.burn_ratio.quantize(Decimal("0.01"))),
            "burn_ratio_threshold": str(UNDER_UTILIZATION_BURN),
            "pct_fy_elapsed": str(m.pct_fy_elapsed.quantize(Decimal("0.0001"))),
            "expenditure_to_date_inr_cr": (
                str(m.expenditure_to_date) if m.expenditure_to_date is not None else None
            ),
            "current_authority_inr_cr": (
                str(m.current_authority) if m.current_authority is not None else None
            ),
            "share_of_authority_spent": (
                str(spent_share.quantize(Decimal("0.0001"))) if spent_share is not None else None
            ),
            "as_of": m.expenditure_as_of.isoformat() if m.expenditure_as_of else None,
        },
        description=(
            f"Expenditure stood at a burn ratio of {m.burn_ratio.quantize(Decimal('0.01'))} "
            f"with {_pct(m.pct_fy_elapsed)} of the financial year elapsed, against a rule "
            f"threshold of {UNDER_UTILIZATION_BURN}. A burn ratio of 1.0 is exactly on pace."
        ),
        does_not_show=(
            "This does not show that funds were withheld or misdirected. Central accounts run "
            "roughly two months behind, several programmes disburse in a small number of large "
            "tranches, and a revised estimate later in the year may change the denominator."
        ),
    )


def rule_over_burn(m: Measures) -> RuleHit | None:
    """Burn ratio above 1.3: spending ahead of the authority to spend."""
    if m.burn_ratio is None or m.pct_fy_elapsed is None:
        return None
    if m.pct_fy_elapsed < OVER_BURN_MIN_FY_ELAPSED:
        return None
    if m.burn_ratio <= OVER_BURN_RATIO:
        return None

    severity: Severity = "high" if m.burn_ratio > OVER_BURN_RATIO_HIGH else "notable"
    return RuleHit(
        rule_id="over_burn",
        severity=severity,
        metric={
            "burn_ratio": str(m.burn_ratio.quantize(Decimal("0.01"))),
            "burn_ratio_threshold": str(OVER_BURN_RATIO),
            "pct_fy_elapsed": str(m.pct_fy_elapsed.quantize(Decimal("0.0001"))),
            "expenditure_to_date_inr_cr": (
                str(m.expenditure_to_date) if m.expenditure_to_date is not None else None
            ),
            "current_authority_inr_cr": (
                str(m.current_authority) if m.current_authority is not None else None
            ),
            "be_inr_cr": str(m.be) if m.be is not None else None,
            "re_inr_cr": str(m.re) if m.re is not None else None,
            "as_of": m.expenditure_as_of.isoformat() if m.expenditure_as_of else None,
        },
        description=(
            f"Expenditure ran at a burn ratio of {m.burn_ratio.quantize(Decimal('0.01'))} with "
            f"{_pct(m.pct_fy_elapsed)} of the year elapsed, above the rule threshold of "
            f"{OVER_BURN_RATIO}."
        ),
        does_not_show=(
            "This does not show that spending exceeded any legal authority. A supplementary "
            "grant or a revised estimate that Parliament has approved may not yet appear in the "
            "documents indexed here, and front-loaded programmes routinely run ahead of an "
            "even-pace comparison."
        ),
    )


def rule_revision_swing(m: Measures) -> RuleHit | None:
    """Revised Estimate more than 25 percent away from the Budget Estimate."""
    if m.be is None or m.re is None or m.be == 0:
        return None
    swing = (m.re - m.be) / m.be
    magnitude = abs(swing)
    if magnitude <= REVISION_SWING:
        return None

    severity: Severity = "high" if magnitude > REVISION_SWING_HIGH else "notable"
    direction = "above" if swing > 0 else "below"
    return RuleHit(
        rule_id="revision_swing",
        severity=severity,
        metric={
            "be_inr_cr": str(m.be),
            "re_inr_cr": str(m.re),
            "swing": str(swing.quantize(Decimal("0.0001"))),
            "swing_magnitude": str(magnitude.quantize(Decimal("0.0001"))),
            "swing_threshold": str(REVISION_SWING),
            "direction": direction,
        },
        description=(
            f"The Revised Estimate is {_pct(magnitude)} {direction} the Budget Estimate, "
            f"against a rule threshold of {_pct(REVISION_SWING)}."
        ),
        does_not_show=(
            "This does not show that the original estimate was wrong or that the revision was "
            "improper. Revised estimates exist precisely to correct for changed circumstances, "
            "and a large revision is often the transparent handling of a known change."
        ),
    )


def rule_spend_no_tender(m: Measures) -> RuleHit | None:
    """Capital-heavy entity with releases but no tenders in the trailing window.

    Tier 2 signal, and therefore ``info`` severity in every case (docs/05 A3).
    Central procurement portal coverage is partial, so an absence here is a
    question worth asking and never a finding.
    """
    if m.tender_count_trailing_90d is None:
        return None
    if m.tender_count_trailing_90d > 0:
        return None
    released = m.released if m.released is not None else m.expenditure_to_date
    if released is None or released < SPEND_NO_TENDER_MIN_RELEASE_CR:
        return None
    share = m.capital_share()
    if share is None or share < SPEND_NO_TENDER_CAPITAL_SHARE:
        return None

    return RuleHit(
        rule_id="spend_no_tender",
        severity="info",
        metric={
            "released_inr_cr": str(released),
            "capital_expenditure_inr_cr": (
                str(m.capital_expenditure) if m.capital_expenditure is not None else None
            ),
            "capital_share": str(share.quantize(Decimal("0.0001"))),
            "tender_count_trailing_90d": m.tender_count_trailing_90d,
            "window_days": SPEND_NO_TENDER_WINDOW_DAYS,
            "release_floor_inr_cr": str(SPEND_NO_TENDER_MIN_RELEASE_CR),
        },
        description=(
            f"No matching tenders were found in the central procurement portal in the trailing "
            f"{SPEND_NO_TENDER_WINDOW_DAYS} days, for an entity with {_pct(share)} of reported "
            f"expenditure on the capital head."
        ),
        does_not_show=(
            "This does not show that procurement did not happen. The central portal does not "
            "carry every contract: state agencies, autonomous bodies and several ministries "
            "procure through their own systems, and portal publication also lags award."
        ),
    )


def rule_stat_outlier(m: Measures) -> RuleHit | None:
    """This month against the same month in prior years, as a z-score.

    Needs at least three prior years, per docs/05. With fewer, the standard
    deviation is an artefact of the sample rather than a description of the
    series, and every unusual-looking month would flag.
    """
    index = m.latest_month_index
    if index is None:
        return None
    current = m.monthly_amounts.get(index)
    history = [value for value in m.monthly_history.get(index, []) if value is not None]
    if current is None or len(history) < STAT_OUTLIER_MIN_HISTORY:
        return None

    floats = [float(value) for value in history]
    mean = Decimal(str(statistics.fmean(floats)))
    stdev = Decimal(str(statistics.pstdev(floats)))
    if stdev < STAT_OUTLIER_MIN_STDEV_CR:
        return None

    z = (current - mean) / stdev
    magnitude = abs(z)
    if magnitude < STAT_OUTLIER_Z:
        return None

    severity: Severity = "high" if magnitude >= STAT_OUTLIER_Z_HIGH else "notable"
    return RuleHit(
        rule_id="stat_outlier",
        severity=severity,
        metric={
            "fiscal_month_index": index,
            "month_amount_inr_cr": str(current),
            "historical_mean_inr_cr": str(mean.quantize(Decimal("0.01"))),
            "historical_stdev_inr_cr": str(stdev.quantize(Decimal("0.01"))),
            "z_score": str(z.quantize(Decimal("0.01"))),
            "z_threshold": str(STAT_OUTLIER_Z),
            "history_years": len(history),
        },
        description=(
            f"Spending in fiscal month {index} was {z.quantize(Decimal('0.01'))} standard "
            f"deviations from the mean of the same month across {len(history)} prior years, "
            f"against a rule threshold of {STAT_OUTLIER_Z}."
        ),
        does_not_show=(
            "This does not show that anything is wrong with the month. A one-off transfer, a "
            "changed accounting classification, or a programme that started or ended will each "
            "produce a large deviation from a historical average."
        ),
    )


#: Evaluation order is the display order on an entity page.
ALL_RULES = (
    rule_under_utilization,
    rule_over_burn,
    rule_march_rush,
    rule_revision_swing,
    rule_stat_outlier,
    rule_spend_no_tender,
)


def evaluate(measures: Measures) -> list[RuleHit]:
    """Run every rule. Pure, deterministic, and the only thing that creates a flag."""
    hits: list[RuleHit] = []
    for rule in ALL_RULES:
        hit = rule(measures)
        if hit is not None:
            hits.append(hit)
    return hits


def rule_descriptions() -> dict[str, str]:
    """One-line statement of each rule, for the admin methodology page."""
    return {
        "march_rush": (
            f"More than {_pct(MARCH_RUSH_Q4_SHARE)} of the year's reported spend in the January "
            f"to March quarter, or more than {_pct(MARCH_RUSH_MARCH_SHARE)} in March alone."
        ),
        "under_utilization": (
            f"Burn ratio below {UNDER_UTILIZATION_BURN} once more than "
            f"{_pct(UNDER_UTILIZATION_MIN_FY_ELAPSED)} of the financial year has elapsed."
        ),
        "over_burn": f"Burn ratio above {OVER_BURN_RATIO}.",
        "revision_swing": (
            f"Revised Estimate more than {_pct(REVISION_SWING)} away from the Budget Estimate."
        ),
        "spend_no_tender": (
            f"A capital-heavy entity with releases above "
            f"{SPEND_NO_TENDER_MIN_RELEASE_CR} crore and no central-portal tender activity in "
            f"the trailing {SPEND_NO_TENDER_WINDOW_DAYS} days."
        ),
        "stat_outlier": (
            f"Monthly spend at least {STAT_OUTLIER_Z} standard deviations from the same month "
            f"across at least {STAT_OUTLIER_MIN_HISTORY} prior years."
        ),
    }
