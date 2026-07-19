"""Indian rupee amount parsing, docs/04 section 5.

Canonical unit for the whole system is **INR crore**, held as :class:`Decimal`.
Never a float: a national total of 50,65,345.12 crore has to survive a round
trip through NUMERIC(20,2), and binary floating point stops being able to
represent that exactly long before the number gets that large.

The single most important behaviour in this module is what it refuses to do.
Government tables put the unit in the column header, in the table caption, in a
footnote, or nowhere at all. A bare ``1234`` might be crore, might be lakh, and
those two readings differ by a factor of a hundred. Guessing produces a chart
that is confidently wrong, so an amount with no unit and no caller-supplied hint
raises :class:`AmbiguousAmountError` and the row goes to the ``parse_error``
queue for a human.

    >>> parse_amount_cr("₹1,23,456.78 crore")
    Decimal('123456.78')
    >>> parse_amount_cr("12,345 lakh")
    Decimal('123.45')
    >>> parse_amount_cr("(1,234)", unit_hint=CRORE)
    Decimal('-1234')
    >>> parse_amount_cr("-") is NOT_REPORTED
    True
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Final


class AmountParseError(ValueError):
    """The text is not an amount we can read."""

    def __init__(self, message: str, raw: str = "") -> None:
        super().__init__(message)
        self.raw = raw


class AmbiguousAmountError(AmountParseError):
    """A number with no unit and no unit hint.

    Deliberately fatal for the row. docs/04 section 5: reject ambiguous values
    into the parse-error queue, never guess. The hundredfold difference between
    lakh and crore is exactly the error nobody notices until a journalist does.
    """


class _NotReported:
    """Sentinel for a cell the source genuinely does not fill in.

    Distinct from ``Decimal(0)``: "not reported" and "reported as nil" are
    different facts and the dashboard renders them differently.
    """

    __slots__ = ()

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return "NOT_REPORTED"

    def __bool__(self) -> bool:
        return False


NOT_REPORTED: Final = _NotReported()

#: Either a real amount in crore, or an explicit "the source does not report
#: this". Callers must narrow before doing arithmetic, which is the point.
type AmountResult = Decimal | _NotReported


@dataclass(frozen=True, slots=True)
class Unit:
    """A magnitude, and what one of it is worth in crore."""

    name: str
    to_crore: Decimal

    def __str__(self) -> str:  # pragma: no cover - debugging aid
        return self.name


RUPEE: Final = Unit("rupee", Decimal("0.0000001"))  # 1 crore = 10,000,000
THOUSAND: Final = Unit("thousand", Decimal("0.0001"))
LAKH: Final = Unit("lakh", Decimal("0.01"))  # 100 lakh = 1 crore
MILLION: Final = Unit("million", Decimal("0.1"))
CRORE: Final = Unit("crore", Decimal("1"))
BILLION: Final = Unit("billion", Decimal("100"))
THOUSAND_CRORE: Final = Unit("thousand crore", Decimal("1000"))
LAKH_CRORE: Final = Unit("lakh crore", Decimal("100000"))
TRILLION: Final = Unit("trillion", Decimal("100000"))

UNITS_BY_NAME: Final[dict[str, Unit]] = {
    unit.name: unit
    for unit in (
        RUPEE,
        THOUSAND,
        LAKH,
        MILLION,
        CRORE,
        BILLION,
        THOUSAND_CRORE,
        LAKH_CRORE,
        TRILLION,
    )
}

# Ordered longest-phrase-first: "lakh crore" has to win over both "lakh" and
# "crore", or 1.2 lakh crore silently becomes 1.2 crore.
_UNIT_PATTERNS: Final[tuple[tuple[re.Pattern[str], Unit], ...]] = (
    (re.compile(r"\blakhs?\s+crores?\b"), LAKH_CRORE),
    (re.compile(r"\blacs?\s+crores?\b"), LAKH_CRORE),
    (re.compile(r"\bthousand\s+crores?\b"), THOUSAND_CRORE),
    (re.compile(r"\bcrores?\b"), CRORE),
    (re.compile(r"\bcr\.?(?![a-z])"), CRORE),
    (re.compile(r"\blakhs?\b"), LAKH),
    (re.compile(r"\blacs?\b"), LAKH),
    (re.compile(r"\btrillions?\b"), TRILLION),
    (re.compile(r"\bbillions?\b"), BILLION),
    (re.compile(r"\bbn\b"), BILLION),
    (re.compile(r"\bmillions?\b"), MILLION),
    (re.compile(r"\bmn\b"), MILLION),
    (re.compile(r"\bthousands?\b"), THOUSAND),
)

# Only meaningful as a unit on its own; after a magnitude it is just the word
# "rupees" trailing "crore rupees" and is discarded.
_RUPEE_PATTERN: Final = re.compile(r"\brupees?\b")

# Currency markers, which say nothing about magnitude.
_CURRENCY_SYMBOLS: Final = re.compile(r"[₹₨₨]")
_CURRENCY_WORDS: Final = re.compile(r"\brs\.?|\binr\b|\brs\b")

#: Text that means "this source does not report a figure here".
#:
#: "Nil" is included deliberately. In principle it asserts zero, but across
#: budget documents, CGA statements and parliament answers it is used
#: interchangeably with a blank, and CLAUDE.md principle 1 makes the honest
#: reading the conservative one: show "Not reported" rather than publish a zero
#: the document may not have meant.
NOT_REPORTED_TOKENS: Final[frozenset[str]] = frozenset(
    {
        "",
        "-",
        "--",
        "---",
        "–",
        "—",
        ".",
        "..",
        "...",
        "*",
        "**",
        "na",
        "n.a.",
        "n.a",
        "n/a",
        "nr",
        "nil",
        "none",
        "not reported",
        "not available",
        "not applicable",
        "no data",
        "neg",
        "negligible",
    }
)

_NUMBER_PATTERN: Final = re.compile(r"^[+-]?\d{1,3}(?:,\d{2,3})*(?:\.\d+)?$|^[+-]?\d+(?:\.\d+)?$")
_ALPHA_RESIDUE: Final = re.compile(r"[a-z]")


def _normalise(text: str) -> str:
    """Fold unicode oddities that PDF extraction reliably produces."""
    folded = unicodedata.normalize("NFKC", text)
    # Non-breaking and thin spaces are everywhere in PDF-extracted tables.
    folded = folded.replace(" ", " ").replace(" ", " ").replace(" ", " ")
    # Devanagari digits appear in some Hindi-language budget annexes.
    folded = "".join(_ascii_digit(ch) for ch in folded)
    return " ".join(folded.split())


def _ascii_digit(ch: str) -> str:
    if ch.isascii() or not ch.isdigit():
        return ch
    try:
        return str(unicodedata.decimal(ch))
    except (ValueError, TypeError):  # pragma: no cover - superscripts and the like
        return ch


def parse_unit_hint(header: str | None) -> Unit | None:
    """Read the unit out of a column header or table caption.

    Handles the forms these documents actually use: ``(₹ in crore)``,
    ``Amount (Rs. in lakhs)``, ``in thousands of rupees``. Returns None when the
    header states no unit, which is the caller's cue that the column carries no
    hint and bare numbers in it are ambiguous.
    """
    if not header:
        return None
    text = _normalise(header).lower()
    for pattern, unit in _UNIT_PATTERNS:
        if pattern.search(text):
            return unit
    if _RUPEE_PATTERN.search(text):
        return RUPEE
    return None


def parse_amount_cr(
    raw: str | int | float | Decimal | None,
    *,
    unit_hint: Unit | None = None,
) -> AmountResult:
    """Parse one cell into a Decimal in crore, or :data:`NOT_REPORTED`.

    A unit written in the cell always wins over ``unit_hint``: a table headed
    "in crore" that spells out "1.2 lakh crore" in one row means what it wrote.

    Raises :class:`AmbiguousAmountError` when there is neither, and
    :class:`AmountParseError` when the text is not a number at all.
    """
    if raw is None:
        return NOT_REPORTED
    if isinstance(raw, bool):
        raise AmountParseError("A boolean is not an amount.", str(raw))
    if isinstance(raw, Decimal | int):
        # Already numeric: the caller still has to say what unit it is in,
        # because a bare number from a spreadsheet is exactly as ambiguous as a
        # bare number from a PDF.
        return _apply_unit(Decimal(raw), unit_hint, str(raw))
    if isinstance(raw, float):
        raise AmountParseError(
            "Refusing to parse a float amount. Money is Decimal everywhere in this system; "
            "pass the original string or a Decimal.",
            str(raw),
        )

    original = raw
    text = _normalise(raw)
    if text.lower().strip() in NOT_REPORTED_TOKENS:
        return NOT_REPORTED

    if "%" in text:
        raise AmountParseError(f"{original!r} is a percentage, not an amount in crore.", original)

    working = text.lower()

    # Accounting form: (1,234) means -1,234. Detected before the currency and
    # unit stripping so that "(₹1,234 crore)" is still recognised.
    negative = False
    stripped = working.strip()
    if stripped.startswith("(") and stripped.endswith(")"):
        negative = True
        working = stripped[1:-1]

    working = _CURRENCY_SYMBOLS.sub(" ", working)
    working = _CURRENCY_WORDS.sub(" ", working)
    # "in crore" / "in lakh" phrasing inside a cell.
    working = re.sub(r"\bin\b", " ", working)

    unit: Unit | None = None
    for pattern, candidate in _UNIT_PATTERNS:
        match = pattern.search(working)
        if match:
            unit = candidate
            working = working[: match.start()] + " " + working[match.end() :]
            break

    if unit is None:
        match = _RUPEE_PATTERN.search(working)
        if match:
            unit = RUPEE
            working = working[: match.start()] + " " + working[match.end() :]
    else:
        # "1,234 crore rupees": the trailing currency word carries no magnitude.
        working = _RUPEE_PATTERN.sub(" ", working)

    working = " ".join(working.split())

    # The unit can sit outside the brackets: "(2,500) lakh". Re-check now that
    # the unit and currency words have been removed.
    if working.startswith("(") and working.endswith(")"):
        negative = not negative
        working = working[1:-1].strip()

    if working in {"", "-", "+"}:
        raise AmountParseError(f"No number found in {original!r}.", original)
    if _ALPHA_RESIDUE.search(working):
        raise AmountParseError(
            f"{original!r} carries text this parser does not understand ({working!r}). "
            f"It is queued rather than guessed at.",
            original,
        )

    number = _to_decimal(working, original)
    if negative:
        number = -number

    return _apply_unit(number, unit or unit_hint, original, had_inline_unit=unit is not None)


def _to_decimal(text: str, original: str) -> Decimal:
    """Parse the numeric core, tolerating Indian digit grouping."""
    compact = text.replace(" ", "")
    if not _NUMBER_PATTERN.match(compact):
        raise AmountParseError(f"Could not read {original!r} as a number.", original)
    try:
        return Decimal(compact.replace(",", ""))
    except InvalidOperation as exc:  # pragma: no cover - regex already guards this
        raise AmountParseError(f"Could not read {original!r} as a number.", original) from exc


def _apply_unit(
    number: Decimal,
    unit: Unit | None,
    original: str,
    *,
    had_inline_unit: bool = False,
) -> Decimal:
    if unit is None:
        # Zero is the one figure that means the same thing in every unit, so it
        # is not ambiguous and does not need a human.
        if number == 0:
            return Decimal(0)
        raise AmbiguousAmountError(
            f"{original!r} carries no unit and no column-header unit was supplied. "
            f"Crore and lakh differ by a factor of a hundred, so this row is queued for "
            f"review rather than guessed at (docs/04 section 5).",
            original,
        )
    result = number * unit.to_crore
    del had_inline_unit
    return result


def parse_amount_series(
    values: Iterable[str | int | Decimal | None],
    *,
    unit_hint: Unit | None = None,
) -> tuple[list[AmountResult], list[tuple[int, str, str]]]:
    """Parse a column of cells, collecting failures instead of raising.

    Returns ``(results, failures)`` where each failure is
    ``(index, raw_text, reason)``. The caller writes the failures to
    ``parse_error`` and reports the ratio as a drift metric: a column that
    suddenly stops parsing is a restructured document, not a bad day.
    """
    results: list[AmountResult] = []
    failures: list[tuple[int, str, str]] = []
    for index, value in enumerate(values):
        try:
            results.append(parse_amount_cr(value, unit_hint=unit_hint))
        except AmountParseError as exc:
            failures.append((index, str(value), str(exc)))
            results.append(NOT_REPORTED)
    return results, failures


def is_reported(value: AmountResult) -> bool:
    """Narrowing helper: True when the value is a real Decimal amount."""
    return isinstance(value, Decimal)


def sum_reported(values: Sequence[AmountResult]) -> tuple[Decimal, int]:
    """Total the reported values, and say how many were skipped.

    The skipped count is not decoration. A total assembled from two thirds of a
    table has to be labelled as partial wherever it is shown.
    """
    total = Decimal(0)
    skipped = 0
    for value in values:
        if isinstance(value, Decimal):
            total += value
        else:
            skipped += 1
    return total, skipped
