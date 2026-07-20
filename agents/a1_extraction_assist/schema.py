"""The structured output A1 returns, and its conversion to a canonical row.

The model reports what the page *printed*: the digits as they appear and the unit
as the document labels it. Conversion to INR crore is done afterwards, in Python,
by the same deterministic parser the pipelines use. Asking the model to convert
would put a hundredfold lakh-to-crore error inside a black box; asking it to
transcribe puts the error where a unit test can find it.
"""

from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from pipelines.lib.models import ANNUAL_STAGES, EntityType, FiscalFactRow, Head, Stage
from pipelines.parsers.inr_amounts import (
    UNITS_BY_NAME,
    AmbiguousAmountError,
    AmountParseError,
    parse_amount_cr,
)

#: NUMERIC(20,2) in INR crore, matching db/migrations/0003.
_CRORE_QUANTUM = Decimal("0.01")

#: Below this a row never reaches staging. docs/05 A1: the deterministic parser
#: is first, the model is a fallback, and a human is the final gate.
AUTO_ACCEPT_CONFIDENCE = 0.85

#: The unit vocabulary the model may use. "unstated" is a first-class answer and
#: routes the row to review rather than to a guess.
UnitAsPrinted = Literal[
    "rupee",
    "thousand",
    "lakh",
    "million",
    "crore",
    "billion",
    "thousand crore",
    "lakh crore",
    "trillion",
    "unstated",
]


class ExtractedRow(BaseModel):
    """One figure the model says the page prints."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    entity_type: EntityType
    #: The raw label as printed. Resolution to a canonical id is A2's job, not
    #: A1's: a transcriber that also guesses identifiers hides two errors as one.
    entity_label_as_printed: str = Field(min_length=1)
    stage: Stage
    head: Head = "total"
    period_start: date | None = None
    period_end: date | None = None
    is_cumulative: bool = False
    amount_as_printed: str = Field(min_length=1)
    unit_as_printed: UnitAsPrinted
    confidence: float = Field(ge=0.0, le=1.0)
    #: Verbatim cell text, so a reviewer can find the figure on the page without
    #: re-reading the whole table.
    source_cell_text: str = ""

    @model_validator(mode="after")
    def _check_period_rules(self) -> ExtractedRow:
        annual = self.stage in ANNUAL_STAGES
        if annual and (self.period_start is not None or self.period_end is not None):
            raise ValueError(f"Stage {self.stage} is an annual figure and carries no period.")
        if not annual and self.period_end is None:
            raise ValueError(f"Stage {self.stage} is a flow figure and needs a period_end.")
        return self


class ExtractionResult(BaseModel):
    """What A1 returns for one page."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    rows: list[ExtractedRow] = Field(default_factory=list)
    page_is_fiscal_table: bool = True
    notes: str = ""


class ResolvedRow(BaseModel):
    """An extracted row after unit conversion, ready for a human to approve."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    row: ExtractedRow
    amount_inr_cr: Decimal | None = None
    conversion_error: str | None = None

    @property
    def is_usable(self) -> bool:
        return self.amount_inr_cr is not None and self.conversion_error is None

    @property
    def needs_review(self) -> bool:
        """True unless the figure is both convertible and confidently read."""
        return not self.is_usable or self.row.confidence < AUTO_ACCEPT_CONFIDENCE

    def to_fiscal_fact_row(self, *, fy: str, entity_id: str) -> FiscalFactRow:
        """Build the canonical row shape for a human-approved extraction.

        Note what this method does not do: it does not write. A1 has no database
        write path at all. The caller hands the result to the admin review queue,
        and only an approved row is ever handed to the ingestion layer, which
        stamps it ``extraction_method='agent_assisted'``.
        """
        if self.amount_inr_cr is None:
            raise ValueError("Cannot build a fiscal fact from a row that failed conversion.")
        return FiscalFactRow(
            fy=fy,
            entity_type=self.row.entity_type,
            entity_id=entity_id,
            stage=self.row.stage,
            head=self.row.head,
            period_start=self.row.period_start,
            period_end=self.row.period_end,
            is_cumulative=self.row.is_cumulative,
            amount_inr_cr=self.amount_inr_cr,
            extraction_method="agent_assisted",
            is_provisional=True,
        )


def resolve_amount(row: ExtractedRow) -> ResolvedRow:
    """Convert one transcribed figure to INR crore, or record why it could not be.

    An "unstated" unit is not an error in the model's answer, it is an honest
    report about the page, and it produces a conversion error so the row goes to
    a human rather than into the store at one of two possible magnitudes.
    """
    if row.unit_as_printed == "unstated":
        return ResolvedRow(
            row=row,
            conversion_error=(
                "The page states no unit for this cell. Crore and lakh differ by a factor of "
                "a hundred, so the row is queued for review rather than guessed at "
                "(docs/04 section 5)."
            ),
        )
    unit = UNITS_BY_NAME.get(row.unit_as_printed)
    if unit is None:  # pragma: no cover - Literal already constrains this
        return ResolvedRow(row=row, conversion_error=f"Unknown unit {row.unit_as_printed!r}.")
    try:
        parsed = parse_amount_cr(row.amount_as_printed, unit_hint=unit)
    except (AmbiguousAmountError, AmountParseError) as exc:
        return ResolvedRow(row=row, conversion_error=str(exc))
    if not isinstance(parsed, Decimal):
        return ResolvedRow(
            row=row,
            conversion_error="The transcribed cell reads as 'not reported', so there is no figure.",
        )
    # Quantised to the two decimal places NUMERIC(20,2) actually holds, so the
    # figure a reviewer approves is the figure that would be stored. A rupee
    # amount converted to crore otherwise carries seven meaningless decimals.
    return ResolvedRow(row=row, amount_inr_cr=parsed.quantize(_CRORE_QUANTUM, ROUND_HALF_UP))
