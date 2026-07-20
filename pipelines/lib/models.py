"""Row shapes written to the canonical store.

These mirror db/migrations/0003 and 0004 exactly, including the CHECK
constraints, so that a bad row fails in Python with a readable message instead
of arriving at Postgres as a constraint violation halfway through a batch.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

EntityType = Literal["ministry", "scheme", "national", "state", "state_department"]
Stage = Literal["BE", "RE", "SUPPLEMENTARY", "SANCTION", "RELEASE", "EXPENDITURE", "UTILIZATION"]
Head = Literal["revenue", "capital", "total"]
ExtractionMethod = Literal[
    "structured_api",
    "csv_parse",
    "html_table",
    "pdf_table",
    "pdf_text",
    "agent_assisted",
    "manual_entry",
    "illustrative",
]

#: Stages that describe an annual authority to spend rather than a flow. They
#: carry no period, and the database CHECK constraint enforces that.
ANNUAL_STAGES: frozenset[str] = frozenset({"BE", "RE", "SUPPLEMENTARY"})


class FiscalFactRow(BaseModel):
    """One canonical fiscal figure, ready for insert.

    ``amount_inr_cr`` is a Decimal in crore. It is never a float: NUMERIC(20,2)
    exists so that a national total of 50,65,345.12 crore survives a round trip,
    and binary floating point would quietly stop being able to represent it.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    fy: str = Field(pattern=r"^FY\d{4}$")
    entity_type: EntityType
    entity_id: str = Field(min_length=1)
    stage: Stage
    head: Head = "total"
    period_start: date | None = None
    period_end: date | None = None
    is_cumulative: bool = False
    amount_inr_cr: Decimal
    extraction_method: ExtractionMethod
    is_provisional: bool = False

    @model_validator(mode="after")
    def _check_period_rules(self) -> FiscalFactRow:
        annual = self.stage in ANNUAL_STAGES
        if annual and (self.period_start is not None or self.period_end is not None):
            raise ValueError(
                f"Stage {self.stage} is an annual authority figure and must carry no period."
            )
        if not annual and self.period_end is None:
            raise ValueError(f"Stage {self.stage} is a flow figure and must carry a period_end.")
        if (
            self.period_start is not None
            and self.period_end is not None
            and self.period_start > self.period_end
        ):
            raise ValueError("period_start must not be after period_end.")
        if self.is_cumulative and self.period_end is None:
            raise ValueError("A cumulative figure must carry the period it accumulates to.")
        return self


class TenderRow(BaseModel):
    """A CPPP tender notice. Tier 2 evidence, never a fiscal figure."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    tender_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    org_raw: str = Field(min_length=1)
    ministry_id: str | None = None
    scheme_id: str | None = None
    value_inr_cr: Decimal | None = None
    status: Literal["published", "awarded", "cancelled"]
    published_date: date | None = None
    award_date: date | None = None
    url: str | None = None
    match_confidence: Literal["high", "medium", "low"] | None = None


class EvidenceRow(BaseModel):
    """A PIB release, a news item or a parliament answer."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    kind: Literal["pib", "news", "parliament_qa"]
    title: str = Field(min_length=1)
    url: str | None = None
    published_date: date | None = None
    ministry_id: str | None = None
    scheme_id: str | None = None
    summary: str | None = None
