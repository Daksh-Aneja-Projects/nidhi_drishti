"""Shapes for A2 entity resolution."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

#: entity_alias.entity_type. Narrower than fiscal_fact's: an alias may point at a
#: demand number, which is never itself a fiscal entity.
AliasEntityType = Literal["ministry", "scheme", "demand"]


class Candidate(BaseModel):
    """A canonical entity proposed by the SQL candidate generator."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    entity_id: str
    name: str
    #: Trigram similarity in 0..1, straight from ``pg_trgm``.
    similarity: float = Field(ge=0.0, le=1.0)
    #: Where the candidate came from: an existing alias or the reference table.
    via: Literal["alias", "reference"] = "reference"

    def as_prompt_line(self) -> str:
        return f"- {self.entity_id}: {self.name} (trigram similarity {self.similarity:.2f})"


class Adjudication(BaseModel):
    """The model's answer for one ambiguous name."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    #: Null means "none of these candidates". A first-class answer, not a failure.
    entity_id: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str = Field(min_length=1, max_length=1200)


class Resolution(BaseModel):
    """What A2 decided and, crucially, where it wrote it."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    raw_name: str
    entity_type: AliasEntityType
    entity_id: str | None
    confidence: float
    #: Mirrors ``entity_alias.resolved_by``. 'queued' means nothing was written
    #: to entity_alias at all and the name is in alias_review_queue instead.
    resolved_by: Literal["exact", "trigram", "agent", "queued"]
    reasoning: str = ""
    candidates: tuple[Candidate, ...] = ()

    @property
    def wrote_alias(self) -> bool:
        return self.resolved_by != "queued"
