"""India fiscal-year utilities, and the month labels CGA publishes.

This is the third implementation of the same rules, alongside
``packages/core/src/fy.ts`` and the SQL helpers in ``db/migrations/0001``. Three
copies is a real risk, so they are kept deliberately identical and each is
tested against the same boundary cases: 31 March and 1 April.

    FY2026 = 2025-04-01 .. 2026-03-31   (labelled by the year it ends)
    Q1 = Apr-Jun, Q2 = Jul-Sep, Q3 = Oct-Dec, Q4 = Jan-Mar
    April is fiscal month 1, March is fiscal month 12

The second half of the module reads the period labels used by the Monthly
Accounts: ``April 2025`` is one month, ``April-November 2025`` is the year to
date and is stored with ``is_cumulative = true``. Getting that flag wrong turns
eight cumulative snapshots into roughly four times the year's actual spend.
"""

from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Final

FY_PATTERN: Final = re.compile(r"^FY(\d{4})$")
MIN_FY_YEAR: Final = 1950
MAX_FY_YEAR: Final = 2200

_MONTH_NAMES: Final[dict[str, int]] = {
    "january": 1,
    "jan": 1,
    "february": 2,
    "feb": 2,
    "march": 3,
    "mar": 3,
    "april": 4,
    "apr": 4,
    "may": 5,
    "june": 6,
    "jun": 6,
    "july": 7,
    "jul": 7,
    "august": 8,
    "aug": 8,
    "september": 9,
    "sep": 9,
    "sept": 9,
    "october": 10,
    "oct": 10,
    "november": 11,
    "nov": 11,
    "december": 12,
    "dec": 12,
}

_SHORT_MONTH: Final = (
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
)


class FiscalYearError(ValueError):
    """Malformed or out-of-range fiscal-year label."""


class PeriodLabelError(ValueError):
    """A month or period label this parser will not guess at."""


# ---------------------------------------------------------------------------
# Fiscal year primitives
# ---------------------------------------------------------------------------


def parse_fy(fy: str) -> int:
    """``"FY2026"`` -> ``2026``, the calendar year the FY ends in."""
    match = FY_PATTERN.match(fy.strip()) if fy else None
    if not match:
        raise FiscalYearError(
            f"Invalid fiscal year {fy!r}. Expected the form FY2026, labelled by the year it ends."
        )
    year = int(match.group(1))
    if not MIN_FY_YEAR <= year <= MAX_FY_YEAR:
        raise FiscalYearError(f"Fiscal year {fy!r} is outside FY{MIN_FY_YEAR}..FY{MAX_FY_YEAR}.")
    return year


def is_fy(value: str) -> bool:
    try:
        parse_fy(value)
    except FiscalYearError:
        return False
    return True


def fy_of(day: date) -> str:
    """The FY a date falls in. 2025-04-01 and 2026-03-31 both give FY2026."""
    return f"FY{day.year if day.month <= 3 else day.year + 1}"


def fy_start(fy: str) -> date:
    return date(parse_fy(fy) - 1, 4, 1)


def fy_end(fy: str) -> date:
    return date(parse_fy(fy), 3, 31)


def fy_bounds(fy: str) -> tuple[date, date]:
    return fy_start(fy), fy_end(fy)


def fy_quarter(day: date) -> int:
    """FY-relative quarter. April is Q1, January is Q4."""
    return ((day.month - 4) % 12) // 3 + 1


def fy_quarter_bounds(fy: str, quarter: int) -> tuple[date, date]:
    if quarter not in (1, 2, 3, 4):
        raise FiscalYearError(f"Quarter must be 1..4, got {quarter}.")
    end_year = parse_fy(fy)
    start_offset = (quarter - 1) * 3  # months after April
    start_month_index = 3 + start_offset  # 3 == April, zero-based from January
    start = date(end_year - 1 + start_month_index // 12, start_month_index % 12 + 1, 1)
    last_month_index = start_month_index + 2
    last_year = end_year - 1 + last_month_index // 12
    last_month = last_month_index % 12 + 1
    end = date(last_year, last_month, calendar.monthrange(last_year, last_month)[1])
    return start, end


def fy_month_index(day: date) -> int:
    """Ordinal of the month within the FY: April = 1 .. March = 12."""
    return (day.month - 4) % 12 + 1


def month_from_fy_index(fy: str, index: int) -> tuple[int, int]:
    """``(year, month)`` for fiscal month ``index`` of ``fy``. April is index 1."""
    if not 1 <= index <= 12:
        raise FiscalYearError(f"Fiscal month index must be 1..12, got {index}.")
    end_year = parse_fy(fy)
    absolute = 3 + (index - 1)  # zero-based month offset from January
    return end_year - 1 + absolute // 12, absolute % 12 + 1


def month_bounds(year: int, month: int) -> tuple[date, date]:
    """First and last calendar day of a month."""
    return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])


def fy_months(fy: str) -> list[date]:
    """The twelve first-of-month dates of an FY, April first."""
    return [date(*month_from_fy_index(fy, index)) for index in range(1, 13)]


def is_within_fy(day: date, fy: str) -> bool:
    start, end = fy_bounds(fy)
    return start <= day <= end


def fy_fraction_elapsed(fy: str, as_of: date) -> Decimal:
    """Fraction of the FY elapsed at ``as_of``, in [0, 1], day exact.

    Day exact rather than month approximated because this is the denominator of
    the burn ratio, and leap years are real. Clamped at both ends so a date
    outside the FY gives 0 or 1 instead of a nonsensical ratio.
    """
    start, end = fy_bounds(fy)
    if as_of < start:
        return Decimal(0)
    if as_of >= end:
        return Decimal(1)
    total_days = (end - start).days + 1
    elapsed_days = (as_of - start).days + 1
    return Decimal(elapsed_days) / Decimal(total_days)


def previous_fy(fy: str) -> str:
    return f"FY{parse_fy(fy) - 1}"


def next_fy(fy: str) -> str:
    return f"FY{parse_fy(fy) + 1}"


def recent_fys(fy: str, count: int) -> list[str]:
    """``count`` fiscal years ending at ``fy``, oldest first."""
    end_year = parse_fy(fy)
    return [f"FY{end_year - count + 1 + offset}" for offset in range(count)]


def fy_from_indian_label(label: str) -> str:
    """Read ``2025-26``, ``2025-2026`` or ``2025 26`` as ``FY2026``.

    Budget documents label the year by its start; we label it by its end. This
    is the one-line conversion that keeps the two from being confused, and it
    validates the pair rather than assuming: ``2025-27`` is a typo, not a
    two-year fiscal year.
    """
    text = label.strip().replace("–", "-").replace("—", "-")
    match = re.match(r"^(?:FY\s*)?(\d{4})\s*[-/ ]\s*(\d{2}|\d{4})$", text, re.IGNORECASE)
    if not match:
        simple = re.match(r"^FY\s*(\d{4})$", text, re.IGNORECASE)
        if simple:
            return f"FY{int(simple.group(1))}"
        raise PeriodLabelError(
            f"Could not read {label!r} as an Indian fiscal-year label such as '2025-26'."
        )
    start_year = int(match.group(1))
    tail = match.group(2)
    end_year = int(tail) if len(tail) == 4 else start_year - start_year % 100 + int(tail)
    # A two-digit tail can roll the century: 1999-00 means 2000.
    if end_year < start_year:
        end_year += 100
    if end_year != start_year + 1:
        raise PeriodLabelError(
            f"{label!r} does not span exactly one fiscal year ({start_year} to {end_year})."
        )
    return f"FY{end_year}"


def format_fy_long(fy: str) -> str:
    """``FY2026 (Apr 2025 to Mar 2026)``. No em-dashes in any copy (docs/06)."""
    end_year = parse_fy(fy)
    return f"FY{end_year} (Apr {end_year - 1} to Mar {end_year})"


# ---------------------------------------------------------------------------
# CGA period labels
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ReportingPeriod:
    """A period a document reports on, ready for a ``fiscal_fact`` row."""

    fy: str
    period_start: date
    period_end: date
    is_cumulative: bool
    label: str

    @property
    def fiscal_month_index(self) -> int:
        """Fiscal ordinal of the period's final month. April is 1."""
        return fy_month_index(self.period_end)

    @property
    def months_covered(self) -> int:
        return (
            (self.period_end.year - self.period_start.year) * 12
            + self.period_end.month
            - self.period_start.month
            + 1
        )


# Word separators need surrounding whitespace: "October" contains the letters
# "to", and a looser pattern splits it into two nonexistent months.
_RANGE_SEPARATOR: Final = re.compile(
    r"\s*-{1,2}\s*|\s+(?:to|through|till|upto|up\s+to)\s+", re.IGNORECASE
)
_YEAR_TAIL: Final = re.compile(r"(\d{4})(?:\s*[-/]\s*(\d{2}|\d{4}))?\s*$")


def parse_month_label(label: str) -> ReportingPeriod:
    """Read the period labels the Monthly Accounts use.

    Accepted, with the whole point being the third form:

    * ``April 2025``                 one month, not cumulative
    * ``Apr 2025``                   same
    * ``April-November 2025``        April to November, **cumulative**
    * ``April 2025 to January 2026`` crosses new year, cumulative
    * ``April-March 2025-26``        the full year, cumulative

    A single trailing year is attached to the *end* month and the start is
    walked back inside the same fiscal year, which is what makes
    ``April-January 2026`` resolve to April 2025 through January 2026 rather
    than to an impossible range.

    Anything else raises rather than being guessed at: a wrong period turns a
    month of spending into a year of it.
    """
    if not label or not label.strip():
        raise PeriodLabelError("Empty period label.")

    text = " ".join(label.replace("–", "-").replace("—", "-").split())
    year_match = _YEAR_TAIL.search(text)
    if not year_match:
        raise PeriodLabelError(
            f"{label!r} carries no year. A month without a year cannot be placed in a fiscal "
            f"year, and this parser does not assume the current one."
        )

    fy_hint: str | None = None
    if year_match.group(2):
        fy_hint = fy_from_indian_label(f"{year_match.group(1)}-{year_match.group(2)}")
        anchor_year = parse_fy(fy_hint)
    else:
        anchor_year = int(year_match.group(1))

    months_part = text[: year_match.start()].strip(" ,")
    if not months_part:
        raise PeriodLabelError(f"{label!r} names a year but no month.")

    pieces = [piece.strip() for piece in _RANGE_SEPARATOR.split(months_part) if piece.strip()]
    if len(pieces) == 1:
        month = _month_number(pieces[0], label)
        year = _resolve_single_year(month, anchor_year, fy_hint)
        start, end = month_bounds(year, month)
        return ReportingPeriod(
            fy=fy_of(end),
            period_start=start,
            period_end=end,
            is_cumulative=False,
            label=text,
        )

    if len(pieces) != 2:
        raise PeriodLabelError(f"Could not read {label!r} as a month or a month range.")

    start_token, end_token = pieces
    start_month = _month_number(start_token, label)
    end_month = _month_number(end_token, label)

    # An explicit year on the start token wins; otherwise the trailing year
    # anchors the end month and the start is walked back within the same FY.
    explicit_start_year = _explicit_year(start_token)
    end_year = _resolve_single_year(end_month, anchor_year, fy_hint)
    if explicit_start_year is not None:
        start_year = explicit_start_year
    else:
        start_year = end_year if start_month <= end_month else end_year - 1

    start = date(start_year, start_month, 1)
    _, end = month_bounds(end_year, end_month)
    if start > end:
        raise PeriodLabelError(f"{label!r} describes a range that ends before it starts.")

    fy = fy_of(end)
    if fy_of(start) != fy:
        raise PeriodLabelError(
            f"{label!r} spans two fiscal years ({fy_of(start)} to {fy}). Cumulative figures are "
            f"only meaningful inside one fiscal year."
        )
    # A range in these documents is always the year to date.
    return ReportingPeriod(
        fy=fy,
        period_start=start,
        period_end=end,
        is_cumulative=True,
        label=text,
    )


def _month_number(token: str, label: str) -> int:
    cleaned = re.sub(r"[^a-z]", "", token.lower())
    if cleaned not in _MONTH_NAMES:
        raise PeriodLabelError(f"{token!r} in {label!r} is not a month name.")
    return _MONTH_NAMES[cleaned]


def _explicit_year(token: str) -> int | None:
    match = re.search(r"\b(\d{4})\b", token)
    return int(match.group(1)) if match else None


def _resolve_single_year(month: int, anchor_year: int, fy_hint: str | None) -> int:
    """Place a month in a calendar year.

    Without an FY hint the anchor year is taken literally: "November 2025" is
    November of 2025. With one, the month is placed inside that fiscal year, so
    "January" in FY2026 is January 2026 while "November" is November 2025.
    """
    if fy_hint is None:
        return anchor_year
    end_year = parse_fy(fy_hint)
    return end_year if month <= 3 else end_year - 1


def month_label(day: date) -> str:
    """``Apr 2025``. Display copy, so no em-dashes and no version strings."""
    return f"{_SHORT_MONTH[day.month - 1]} {day.year}"


# ---------------------------------------------------------------------------
# De-cumulation
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class MonthlyDelta:
    """One de-cumulated month."""

    fiscal_month_index: int
    period_end: date
    cumulative: Decimal
    #: None when the previous month is missing, because the delta is genuinely
    #: unrecoverable. Never zero, never carried forward.
    monthly: Decimal | None
    #: True when the delta came out negative, which means the source revised an
    #: earlier month downward.
    is_revision_artifact: bool


def decumulate(series: list[tuple[date, Decimal]]) -> list[MonthlyDelta]:
    """Turn a cumulative April-to-date series into monthly figures.

    The rule from docs/04 section 3, implemented here exactly as the SQL view
    implements it:

    * ``monthly = cumulative(m) - cumulative(m-1)``;
    * a negative result is a revision. It is kept and flagged, never clamped to
      zero. Clamping would inflate the annual total and hide the revision, which
      is the opposite of what this product exists to do;
    * a gap in the series makes the following month unrecoverable, so it is
      None rather than two months of spend piled onto one bar.

    Input is ``(period_end, cumulative_amount)`` pairs in any order, all within
    one fiscal year.
    """
    if not series:
        return []

    ordered = sorted(series, key=lambda item: fy_month_index(item[0]))
    fys = {fy_of(day) for day, _ in ordered}
    if len(fys) > 1:
        raise ValueError(
            f"De-cumulation needs a single fiscal year; got {sorted(fys)}. A cumulative series "
            f"restarts at zero each April, so mixing years would produce nonsense."
        )

    results: list[MonthlyDelta] = []
    previous_index: int | None = None
    previous_amount: Decimal | None = None

    for day, amount in ordered:
        index = fy_month_index(day)
        if previous_index is None:
            # April's cumulative figure is also its monthly figure. Any later
            # first-reported month has no predecessor to subtract.
            monthly = amount if index == 1 else None
        elif index - previous_index != 1:
            monthly = None
        else:
            assert previous_amount is not None
            monthly = amount - previous_amount

        results.append(
            MonthlyDelta(
                fiscal_month_index=index,
                period_end=day,
                cumulative=amount,
                monthly=monthly,
                is_revision_artifact=monthly is not None and monthly < 0,
            )
        )
        previous_index = index
        previous_amount = amount

    return results
