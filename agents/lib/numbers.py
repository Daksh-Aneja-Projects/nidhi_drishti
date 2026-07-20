"""Finding numbers in generated prose, and checking them against the facts.

This is the mechanical half of the A4 self check (docs/05 A4 step 5) and the
same guard is applied to A3 explanations. A model that has been given the right
figures still occasionally produces a plausible neighbour of one, and a
plausible neighbour on a transparency site is the worst possible failure: it is
wrong, it is specific, and it looks exactly like everything around it that is
right.

The rule enforced here is strict on purpose: **a number in the prose must appear
in the facts**. Not be derivable from them. Derived figures are legitimate, so
the fact bundle pre-computes the ones a narrative may need (shares, balances,
ratios) and hands them over as facts. That way the check stays "did you copy" and
never becomes "is your arithmetic right", which is not a question a regular
expression can answer.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

#: Fiscal-year labels are identifiers, not quantities.
_FY_LABEL = re.compile(r"\bFY\d{4}\b", re.IGNORECASE)
#: Citation markers such as [source:412], [tender:CPPP/2025/0011], [evidence:7].
_CITATION = re.compile(r"\[(?:source|tender|evidence):[^\]]*\]", re.IGNORECASE)
#: Markdown headings and list markers contribute no quantities.
_MD_NOISE = re.compile(r"^\s{0,3}#{1,6}\s|^\s*[-*]\s", re.MULTILINE)
#: ISO dates and Indian-style dates. Removed before number extraction so a date
#: does not decompose into three unmatched integers.
_DATES = re.compile(
    r"\b\d{4}-\d{2}-\d{2}\b"
    r"|\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October"
    r"|November|December)\s+\d{4}\b"
    r"|\b(?:January|February|March|April|May|June|July|August|September|October|November"
    r"|December)\s+\d{4}\b"
    r"|\b\d{4}-\d{2}\b",
    re.IGNORECASE,
)
#: Quarter labels: Q1..Q4.
_QUARTER = re.compile(r"\bQ[1-4]\b", re.IGNORECASE)

#: A quantity: optional sign, Indian or Western digit grouping, optional decimals.
#: The grouped branch requires at least one comma group. With ``*`` it would
#: match the first three digits of an ungrouped "3000" and leave a stray "0"
#: behind, which would then look like an unsupported figure.
_NUMBER = re.compile(r"[-+]?\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|[-+]?\d+(?:\.\d+)?")


@dataclass(frozen=True, slots=True)
class NumberMention:
    """One quantity found in generated prose."""

    raw: str
    value: Decimal
    #: Characters of context either side, for the failure message.
    context: str

    @property
    def decimals(self) -> int:
        _, _, frac = self.raw.replace(",", "").partition(".")
        return len(frac)


def strip_non_quantities(text: str) -> str:
    """Remove the things that look numeric but are not measurements."""
    cleaned = _CITATION.sub(" ", text)
    cleaned = _FY_LABEL.sub(" ", cleaned)
    cleaned = _DATES.sub(" ", cleaned)
    cleaned = _QUARTER.sub(" ", cleaned)
    return _MD_NOISE.sub(" ", cleaned)


def extract_numbers(text: str) -> list[NumberMention]:
    """Every quantity in ``text``, in order of appearance."""
    cleaned = strip_non_quantities(text)
    mentions: list[NumberMention] = []
    for match in _NUMBER.finditer(cleaned):
        raw = match.group(0)
        try:
            value = Decimal(raw.replace(",", "").replace("+", ""))
        except InvalidOperation:  # pragma: no cover - regex already constrains this
            continue
        start = max(0, match.start() - 40)
        end = min(len(cleaned), match.end() + 40)
        mentions.append(
            NumberMention(raw=raw, value=value, context=" ".join(cleaned[start:end].split()))
        )
    return mentions


def _matches(mention: NumberMention, allowed: Decimal) -> bool:
    """True when ``allowed`` is the value the prose printed.

    Compared at the precision the prose used, so a fact of 1234.56 written as
    "1,234.56" matches, and so does the same fact written as "1,235" when the
    writer rounded to whole crore. Anything else is a different number.
    """
    if mention.value == allowed:
        return True
    places = Decimal(1).scaleb(-mention.decimals)
    try:
        return allowed.quantize(places) == mention.value.quantize(places)
    except InvalidOperation:  # pragma: no cover - absurdly large exponents only
        return False


def unsupported_numbers(
    text: str,
    allowed_values: set[Decimal],
    *,
    ignore_below: Decimal | None = None,
) -> list[NumberMention]:
    """Quantities in ``text`` that do not appear in ``allowed_values``.

    ``ignore_below`` exempts small integers that are ordinary prose rather than
    measurements ("two of the three quarters"). Left unset by default: in a
    fiscal narrative a bare number is nearly always a claim.
    """
    problems: list[NumberMention] = []
    for mention in extract_numbers(text):
        if ignore_below is not None and abs(mention.value) < ignore_below:
            continue
        if any(_matches(mention, allowed) for allowed in allowed_values):
            continue
        problems.append(mention)
    return problems


def collect_allowed_values(payload: object) -> set[Decimal]:
    """Every numeric value anywhere in a nested facts structure.

    Walks dicts, lists and scalars. Numbers stored as strings count, because the
    fact bundles carry money as ``str(Decimal)`` to keep JSON serialisation exact.
    """
    found: set[Decimal] = set()
    _walk(payload, found)
    return found


def _walk(node: object, found: set[Decimal]) -> None:
    if isinstance(node, bool) or node is None:
        return
    if isinstance(node, Decimal):
        found.add(node)
        return
    if isinstance(node, int):
        found.add(Decimal(node))
        return
    if isinstance(node, float):  # pragma: no cover - money is never a float here
        found.add(Decimal(str(node)))
        return
    if isinstance(node, str):
        for match in _NUMBER.finditer(node):
            try:
                found.add(Decimal(match.group(0).replace(",", "").replace("+", "")))
            except InvalidOperation:
                continue
        return
    if isinstance(node, dict):
        for key, value in node.items():
            _walk(key, found)
            _walk(value, found)
        return
    if isinstance(node, (list, tuple, set, frozenset)):
        for item in node:
            _walk(item, found)
