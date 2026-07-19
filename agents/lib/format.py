"""Display formatting shared by the fallback templates and the digest.

Indian digit grouping is not a cosmetic preference here. A reader who sees
``12,34,567`` and a reader who sees ``1,234,567`` are reading the same number,
but only one of them can check it against the source document at a glance.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

#: What a missing figure renders as. Never zero: CLAUDE.md principle 1 draws a
#: hard line between "reported as nil" and "not reported at all".
NOT_REPORTED = "Not reported"


def indian_group(value: Decimal | int | str) -> str:
    """Group digits Indian-style: last three, then pairs. 1234567 -> 12,34,567."""
    number = Decimal(str(value))
    sign = "-" if number < 0 else ""
    quantized = abs(number).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    whole, _, frac = f"{quantized:f}".partition(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        pairs: list[str] = []
        while len(head) > 2:
            pairs.insert(0, head[-2:])
            head = head[:-2]
        if head:
            pairs.insert(0, head)
        whole = ",".join([*pairs, tail])
    frac = frac.rstrip("0")
    return f"{sign}{whole}" + (f".{frac}" if frac else "")


def crore(value: Decimal | int | None) -> str:
    """Render an INR crore figure, or 'Not reported' when it is absent."""
    if value is None:
        return NOT_REPORTED
    return f"₹{indian_group(value)} cr"


def percent(value: Decimal | float | None, *, places: int = 1) -> str:
    if value is None:
        return NOT_REPORTED
    quantum = Decimal(1).scaleb(-places)
    return f"{Decimal(str(value)).quantize(quantum, rounding=ROUND_HALF_UP)}%"


def ratio(value: Decimal | float | None, *, places: int = 2) -> str:
    if value is None:
        return NOT_REPORTED
    quantum = Decimal(1).scaleb(-places)
    return str(Decimal(str(value)).quantize(quantum, rounding=ROUND_HALF_UP))
