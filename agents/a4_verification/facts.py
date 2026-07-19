"""The fact bundle A4 writes from, and the queries that build it.

Everything the narrative is allowed to say lives in one object. That is what
makes the self check in :mod:`agents.a4_verification.self_check` possible at all:
"every number in the narrative appears in the facts" is only enforceable if
"the facts" is a closed, enumerable set rather than whatever happened to be in
the prompt.

Derived figures (balance, share spent, burn ratio) are computed **here**, in
Python, from Decimals, and handed to the model as facts. The model is then
forbidden to compute anything. This is deliberate: a division the model performs
is untraceable to a source record, and a division we perform is a line of code
with a test.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Literal

EntityType = Literal["ministry", "scheme", "national"]

FISCAL_FACTS_SQL = """
SELECT f.stage,
       f.head,
       f.amount_inr_cr,
       f.period_start,
       f.period_end,
       f.is_cumulative,
       f.is_provisional,
       f.source_record_id,
       f.source_id,
       f.source_url,
       f.document_date,
       f.fetched_at
  FROM v_fiscal_fact_current f
 WHERE f.fy = %(fy)s
   AND f.entity_type = %(entity_type)s
   AND f.entity_id = %(entity_id)s
 ORDER BY CASE f.stage
            WHEN 'BE' THEN 0 WHEN 'RE' THEN 1 WHEN 'SUPPLEMENTARY' THEN 2
            WHEN 'SANCTION' THEN 3 WHEN 'RELEASE' THEN 4 WHEN 'EXPENDITURE' THEN 5
            ELSE 6 END,
          f.period_end NULLS FIRST
"""

TENDERS_SQL = """
SELECT tender_id, title, value_inr_cr, status, published_date, award_date, url,
       match_confidence
  FROM tender
 WHERE published_date BETWEEN fy_start(%(fy)s) AND fy_end(%(fy)s)
   AND (
     (%(entity_type)s = 'ministry' AND ministry_id = %(entity_id)s)
     OR (%(entity_type)s = 'scheme' AND scheme_id = %(entity_id)s)
   )
 ORDER BY published_date DESC
 LIMIT %(limit)s
"""

#: Evidence retrieval. Vector similarity when an embedding is supplied, recency
#: otherwise, and always bounded to the fiscal year: an FY2026 verification page
#: illustrated with an FY2021 press release would be worse than an empty one.
EVIDENCE_BY_RECENCY_SQL = """
SELECT evidence_id, kind, title, url, published_date, summary
  FROM evidence_item
 WHERE published_date BETWEEN fy_start(%(fy)s) AND fy_end(%(fy)s)
   AND (
     (%(entity_type)s = 'ministry' AND ministry_id = %(entity_id)s)
     OR (%(entity_type)s = 'scheme' AND scheme_id = %(entity_id)s)
   )
 ORDER BY published_date DESC
 LIMIT %(limit)s
"""

EVIDENCE_BY_SIMILARITY_SQL = """
SELECT evidence_id, kind, title, url, published_date, summary,
       1 - (embedding <=> %(query_embedding)s::vector) AS similarity
  FROM evidence_item
 WHERE embedding IS NOT NULL
   AND published_date BETWEEN fy_start(%(fy)s) AND fy_end(%(fy)s)
   AND (
     (%(entity_type)s = 'ministry' AND ministry_id = %(entity_id)s)
     OR (%(entity_type)s = 'scheme' AND scheme_id = %(entity_id)s)
   )
 ORDER BY embedding <=> %(query_embedding)s::vector
 LIMIT %(limit)s
"""

ENTITY_LABEL_SQL = """
SELECT COALESCE(
         (SELECT name FROM ministry WHERE ministry_id = %(entity_id)s),
         (SELECT name FROM scheme   WHERE scheme_id  = %(entity_id)s),
         %(entity_id)s
       ) AS entity_label
"""

_TWO_PLACES = Decimal("0.01")


def _q(value: Decimal, places: Decimal = _TWO_PLACES) -> Decimal:
    return value.quantize(places, rounding=ROUND_HALF_UP)


@dataclass(frozen=True, slots=True)
class FactLine:
    """One fiscal figure with the source record behind it."""

    stage: str
    head: str
    amount_inr_cr: Decimal
    source_record_id: int
    source_id: str | None = None
    source_url: str | None = None
    document_date: date | None = None
    period_start: date | None = None
    period_end: date | None = None
    is_cumulative: bool = False
    is_provisional: bool = False

    def as_prompt_line(self) -> str:
        period = ""
        if self.period_end is not None:
            kind = "cumulative to" if self.is_cumulative else "period ending"
            period = f", {kind} {self.period_end.isoformat()}"
        provisional = ", provisional" if self.is_provisional else ""
        return (
            f"- {self.stage} ({self.head}): {self.amount_inr_cr} INR crore{period}{provisional} "
            f"[source:{self.source_record_id}] "
            f"document dated {self.document_date.isoformat() if self.document_date else 'unknown'}"
        )


@dataclass(frozen=True, slots=True)
class TenderLine:
    tender_id: str
    title: str
    status: str
    value_inr_cr: Decimal | None = None
    published_date: date | None = None
    match_confidence: str | None = None
    url: str | None = None

    def as_prompt_line(self) -> str:
        value = f"{self.value_inr_cr} INR crore" if self.value_inr_cr is not None else "value not published"
        return (
            f"- [tender:{self.tender_id}] {self.title} ({self.status}, {value}, "
            f"published {self.published_date.isoformat() if self.published_date else 'undated'}, "
            f"name match {self.match_confidence or 'unrecorded'})"
        )


@dataclass(frozen=True, slots=True)
class EvidenceLine:
    evidence_id: int
    kind: str
    title: str
    published_date: date | None = None
    summary: str | None = None
    url: str | None = None

    def as_prompt_line(self) -> str:
        return (
            f"- [evidence:{self.evidence_id}] {self.kind} "
            f"{self.published_date.isoformat() if self.published_date else 'undated'}: "
            f"{self.title}. {self.summary or ''}".strip()
        )


@dataclass(frozen=True, slots=True)
class FactBundle:
    """The closed world the narrative may describe."""

    entity_type: EntityType
    entity_id: str
    entity_label: str
    fy: str
    fiscal_facts: tuple[FactLine, ...] = ()
    tenders: tuple[TenderLine, ...] = ()
    evidence: tuple[EvidenceLine, ...] = ()
    web_results: tuple[str, ...] = ()
    #: Figures computed here so the model never has to. Ordered dict of label to
    #: value, rendered into the prompt and included in the allowed values.
    derived: dict[str, Decimal] = field(default_factory=dict)

    # -- derived measures ---------------------------------------------------

    def stage_amount(self, stage: str, head: str = "total") -> Decimal | None:
        matches = [
            line.amount_inr_cr
            for line in self.fiscal_facts
            if line.stage == stage and line.head == head
        ]
        if not matches:
            return None
        # RE and BE are annual singletons; for period-bearing stages the latest
        # cumulative figure is the meaningful one and it sorts last.
        return matches[-1]

    @property
    def as_of(self) -> date | None:
        dates = [line.period_end for line in self.fiscal_facts if line.period_end is not None]
        return max(dates) if dates else None

    @property
    def has_any_facts(self) -> bool:
        return bool(self.fiscal_facts)

    def allowed_values(self) -> set[Decimal]:
        """Every quantity the narrative is permitted to state.

        Built field by field rather than by walking the whole structure: a walk
        would sweep in tender identifiers and date fragments and quietly make the
        self check permissive, which is the one thing it must never be.
        """
        values: set[Decimal] = set()
        for line in self.fiscal_facts:
            values.add(line.amount_inr_cr)
            values.add(_q(line.amount_inr_cr, Decimal("1")))
        for tender in self.tenders:
            if tender.value_inr_cr is not None:
                values.add(tender.value_inr_cr)
                values.add(_q(tender.value_inr_cr, Decimal("1")))
        values |= set(self.derived.values())
        # Counts a narrative may legitimately state.
        values.add(Decimal(len(self.tenders)))
        values.add(Decimal(len(self.evidence)))
        return values

    # -- prompt rendering ---------------------------------------------------

    def render_fiscal_facts(self) -> str:
        lines = [line.as_prompt_line() for line in self.fiscal_facts]
        if self.derived:
            lines.append("")
            lines.append("Figures already computed for you. Use these rather than calculating:")
            lines.extend(f"- {label}: {value}" for label, value in self.derived.items())
        return "\n".join(lines) or "(no fiscal facts are recorded for this entity and year)"

    def render_tenders(self) -> str:
        return "\n".join(t.as_prompt_line() for t in self.tenders) or (
            "(no tenders matched this entity in the central procurement portal for this year)"
        )

    def render_evidence(self) -> str:
        return "\n".join(e.as_prompt_line() for e in self.evidence) or (
            "(no press releases, news items or parliament answers were indexed for this "
            "entity and year)"
        )

    def render_web_results(self) -> str:
        if not self.web_results:
            return "disabled"
        return "\n".join(f"- {url}" for url in self.web_results)

    def as_check_payload(self) -> dict[str, Any]:
        """The facts, flattened for the self-check prompt."""
        return {
            "entity": f"{self.entity_label} ({self.entity_type} {self.entity_id})",
            "fy": self.fy,
            "fiscal_facts": [line.as_prompt_line() for line in self.fiscal_facts],
            "derived": {label: str(value) for label, value in self.derived.items()},
            "tenders": [t.as_prompt_line() for t in self.tenders],
            "evidence": [e.as_prompt_line() for e in self.evidence],
            "web_results": list(self.web_results),
        }


def compute_derived(bundle: FactBundle) -> dict[str, Decimal]:
    """Pre-compute the handful of figures a narrative usually wants.

    Only from figures that are present. A missing input produces a missing
    derived value, never a zero: CLAUDE.md principle 1 draws that line and this
    is one of the places it would be easiest to cross by accident.
    """
    derived: dict[str, Decimal] = {}
    be = bundle.stage_amount("BE")
    re_ = bundle.stage_amount("RE")
    supplementary = bundle.stage_amount("SUPPLEMENTARY")
    expenditure = bundle.stage_amount("EXPENDITURE")
    released = bundle.stage_amount("RELEASE")
    utilized = bundle.stage_amount("UTILIZATION")

    authority = re_ if re_ is not None else be
    if authority is not None and supplementary is not None:
        authority = authority + supplementary
    if authority is not None:
        derived["current authority in INR crore"] = _q(authority)

    if authority is not None and expenditure is not None:
        derived["expenditure to date in INR crore"] = _q(expenditure)
        derived["unspent balance in INR crore"] = _q(authority - expenditure)
        if authority > 0:
            derived["share of authority spent, percent"] = _q(
                expenditure / authority * 100, Decimal("0.1")
            )
    if authority is not None and released is not None:
        derived["released in INR crore"] = _q(released)
        if authority > 0:
            derived["share of authority released, percent"] = _q(
                released / authority * 100, Decimal("0.1")
            )
    if authority is not None and utilized is not None and authority > 0:
        derived["utilization against allocation, percent"] = _q(
            utilized / authority * 100, Decimal("0.1")
        )
    if be is not None and re_ is not None and be != 0:
        derived["revision against budget estimate, percent"] = _q(
            (re_ - be) / be * 100, Decimal("0.1")
        )
    tender_value = sum(
        (t.value_inr_cr for t in bundle.tenders if t.value_inr_cr is not None),
        Decimal(0),
    )
    if bundle.tenders:
        derived["total value of matched tenders in INR crore"] = _q(tender_value)
    return derived
