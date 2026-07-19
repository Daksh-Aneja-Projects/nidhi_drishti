"""A4 - the verification agent (docs/05 A4).

The pipeline, in order:

1. Pull the fiscal facts for entity and fiscal year.
2. Retrieve evidence: tenders from SQL, press and parliament items by vector
   similarity where an embedding is available and by recency otherwise.
3. Optionally search the live web, off by default, restricted to a domain
   allowlist when on.
4. Compose ``narrative_md``, every claim cited.
5. **Self check.** A second call verifies every number in the narrative appears
   in the facts. One regeneration on failure, then a deterministic template
   rendering with ``is_fallback = true``.

``self_check_passed`` is recorded on the row either way, so the admin surface can
see the rate directly, and docs/09 can alert on it crossing ten percent.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, Literal

import structlog
from pydantic import BaseModel, ConfigDict, Field

from agents.a4_verification.facts import (
    ENTITY_LABEL_SQL,
    EVIDENCE_BY_RECENCY_SQL,
    EVIDENCE_BY_SIMILARITY_SQL,
    FISCAL_FACTS_SQL,
    TENDERS_SQL,
    EntityType,
    EvidenceLine,
    FactBundle,
    FactLine,
    TenderLine,
    compute_derived,
)
from agents.a4_verification.fallback import render_fallback
from agents.a4_verification.self_check import SelfCheckResult, run_self_check
from agents.lib.client import AgentCallError, AgentClient
from agents.lib.db import GuardedConnection, fetch_all, insert_verification_report
from agents.lib.prompts import Prompt, find_banned_vocabulary, load_prompt

log = structlog.get_logger(__name__)

AGENT_ID = "A4"
PROMPT_NAME = "a4_narrative"

TENDER_LIMIT = 12
EVIDENCE_LIMIT = 10


class Citation(BaseModel):
    """One citation chip under the narrative."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    kind: Literal["source", "tender", "evidence", "web"]
    ref: str
    label: str = ""


class NarrativeDraft(BaseModel):
    """What the writing model returns."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    narrative_md: str = Field(min_length=80, max_length=6000)
    citations: list[Citation] = Field(default_factory=list)
    confidence: Literal["high", "medium", "low"]


@dataclass(frozen=True, slots=True)
class VerificationOutcome:
    """The report, and everything the admin surface needs to judge it."""

    bundle: FactBundle
    narrative_md: str
    citations: tuple[dict[str, Any], ...]
    confidence: str
    self_check_passed: bool
    is_fallback: bool
    model: str
    prompt_version: str
    attempts: int
    self_check: SelfCheckResult | None = None
    report_id: int | None = None


def _as_date(value: Any) -> date | None:
    if value is None or isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def _as_decimal(value: Any) -> Decimal | None:
    return None if value is None else Decimal(str(value))


class VerificationAgent:
    """docs/05 A4. Composes, then checks itself, then falls back rather than guess."""

    def __init__(
        self,
        client: AgentClient,
        conn: GuardedConnection,
        *,
        prompt: Prompt | None = None,
    ) -> None:
        self.client = client
        self.conn = conn
        self.prompt = prompt or load_prompt(PROMPT_NAME)

    # -- steps 1 to 3: build the fact bundle --------------------------------

    def build_bundle(
        self,
        entity_type: EntityType,
        entity_id: str,
        fy: str,
        *,
        query_embedding: list[float] | None = None,
        web_results: tuple[str, ...] = (),
    ) -> FactBundle:
        label_row = fetch_all(self.conn, ENTITY_LABEL_SQL, {"entity_id": entity_id})
        entity_label = (
            str(label_row[0]["entity_label"])
            if label_row
            else ("Union Government" if entity_type == "national" else entity_id)
        )
        scope = {"fy": fy, "entity_type": entity_type, "entity_id": entity_id}

        facts = tuple(
            FactLine(
                stage=str(row["stage"]),
                head=str(row["head"]),
                amount_inr_cr=Decimal(str(row["amount_inr_cr"])),
                source_record_id=int(row["source_record_id"]),
                source_id=row.get("source_id"),
                source_url=row.get("source_url"),
                document_date=_as_date(row.get("document_date")),
                period_start=_as_date(row.get("period_start")),
                period_end=_as_date(row.get("period_end")),
                is_cumulative=bool(row.get("is_cumulative")),
                is_provisional=bool(row.get("is_provisional")),
            )
            for row in fetch_all(self.conn, FISCAL_FACTS_SQL, scope)
        )

        tenders = tuple(
            TenderLine(
                tender_id=str(row["tender_id"]),
                title=str(row["title"]),
                status=str(row["status"]),
                value_inr_cr=_as_decimal(row.get("value_inr_cr")),
                published_date=_as_date(row.get("published_date")),
                match_confidence=row.get("match_confidence"),
                url=row.get("url"),
            )
            for row in fetch_all(self.conn, TENDERS_SQL, {**scope, "limit": TENDER_LIMIT})
        )

        if query_embedding is not None:
            evidence_rows = fetch_all(
                self.conn,
                EVIDENCE_BY_SIMILARITY_SQL,
                {**scope, "limit": EVIDENCE_LIMIT, "query_embedding": query_embedding},
            )
        else:
            evidence_rows = fetch_all(
                self.conn, EVIDENCE_BY_RECENCY_SQL, {**scope, "limit": EVIDENCE_LIMIT}
            )
        evidence = tuple(
            EvidenceLine(
                evidence_id=int(row["evidence_id"]),
                kind=str(row["kind"]),
                title=str(row["title"]),
                published_date=_as_date(row.get("published_date")),
                summary=row.get("summary"),
                url=row.get("url"),
            )
            for row in evidence_rows
        )

        bundle = FactBundle(
            entity_type=entity_type,
            entity_id=entity_id,
            entity_label=entity_label,
            fy=fy,
            fiscal_facts=facts,
            tenders=tenders,
            evidence=evidence,
            web_results=web_results,
        )
        return FactBundle(
            entity_type=bundle.entity_type,
            entity_id=bundle.entity_id,
            entity_label=bundle.entity_label,
            fy=bundle.fy,
            fiscal_facts=bundle.fiscal_facts,
            tenders=bundle.tenders,
            evidence=bundle.evidence,
            web_results=bundle.web_results,
            derived=compute_derived(bundle),
        )

    def search_web(self, bundle: FactBundle) -> tuple[str, ...]:
        """Optional step 3. Returns an empty tuple unless explicitly enabled.

        The tool definition carries the domain allowlist, so the restriction is
        enforced server-side rather than by filtering results after the model has
        already read them.
        """
        settings = self.client.settings
        if not settings.enable_web_search:
            return ()
        tool = settings.web_search_tool(max_uses=3)
        try:
            result = self.client.complete(
                agent_id=AGENT_ID,
                prompt=self.prompt,
                system=(
                    "Search only for recent public reporting about the named entity's spending "
                    "or programme activity in the last 30 days. Return a short list of what you "
                    "found. If nothing relevant is found, say that no evidence found in the "
                    "last 30 days. Never use the words scam, fraud, siphoned or corrupt."
                ),
                user_content=(
                    f"Entity: {bundle.entity_label}. Financial year: {bundle.fy}. "
                    "Look for programme activity, releases and procurement reporting."
                ),
                model=settings.model_fast,
                tools=[tool],
                entity_type=bundle.entity_type,
                entity_id=bundle.entity_id,
            )
        except (AgentCallError, Exception) as exc:  # noqa: BLE001 - search is optional
            log.warning("a4.web_search_failed", entity_id=bundle.entity_id, error=str(exc)[:300])
            return ()
        allowed = tuple(settings.web_search_allowlist)
        # Defence in depth: the tool was already restricted, and anything that
        # somehow came back from elsewhere is dropped rather than cited.
        return tuple(url for url in result.web_sources if _host_allowed(url, allowed))

    # -- step 4: compose ----------------------------------------------------

    def compose(self, bundle: FactBundle, *, feedback: str | None = None) -> NarrativeDraft:
        system = self.prompt.render(
            entity_label=bundle.entity_label,
            entity_type=bundle.entity_type,
            entity_id=bundle.entity_id,
            fy=bundle.fy,
            fiscal_facts=bundle.render_fiscal_facts(),
            tenders=bundle.render_tenders(),
            evidence=bundle.render_evidence(),
            web_results=bundle.render_web_results(),
        )
        instruction = (
            "Write the verification narrative for this entity and financial year."
            if feedback is None
            else "Rewrite the verification narrative.\n\n" + feedback
        )
        return self.client.structured(
            agent_id=AGENT_ID,
            prompt=self.prompt,
            system=system,
            user_content=instruction,
            schema=NarrativeDraft,
            model=self.client.settings.model_narrative,
            entity_type=bundle.entity_type,
            entity_id=bundle.entity_id,
            thinking={"type": "adaptive"},
            effort="high",
        )

    # -- entry point --------------------------------------------------------

    def run(
        self,
        entity_type: EntityType,
        entity_id: str,
        fy: str,
        *,
        query_embedding: list[float] | None = None,
        write: bool = True,
    ) -> VerificationOutcome:
        bundle = self.build_bundle(entity_type, entity_id, fy, query_embedding=query_embedding)
        web = self.search_web(bundle)
        if web:
            bundle = FactBundle(
                entity_type=bundle.entity_type,
                entity_id=bundle.entity_id,
                entity_label=bundle.entity_label,
                fy=bundle.fy,
                fiscal_facts=bundle.fiscal_facts,
                tenders=bundle.tenders,
                evidence=bundle.evidence,
                web_results=web,
                derived=bundle.derived,
            )

        outcome = self._compose_and_check(bundle)
        if write:
            report_id = insert_verification_report(
                self.conn,
                {
                    "entity_type": bundle.entity_type,
                    "entity_id": bundle.entity_id,
                    "fy": bundle.fy,
                    "narrative_md": outcome.narrative_md,
                    "citations": list(outcome.citations),
                    "confidence": outcome.confidence,
                    "self_check_passed": outcome.self_check_passed,
                    "is_fallback": outcome.is_fallback,
                    "model": outcome.model,
                    "prompt_version": outcome.prompt_version,
                },
            )
            outcome = VerificationOutcome(
                bundle=outcome.bundle,
                narrative_md=outcome.narrative_md,
                citations=outcome.citations,
                confidence=outcome.confidence,
                self_check_passed=outcome.self_check_passed,
                is_fallback=outcome.is_fallback,
                model=outcome.model,
                prompt_version=outcome.prompt_version,
                attempts=outcome.attempts,
                self_check=outcome.self_check,
                report_id=report_id,
            )
        log.info(
            "a4.report_generated",
            entity_type=bundle.entity_type,
            entity_id=bundle.entity_id,
            fy=fy,
            self_check_passed=outcome.self_check_passed,
            is_fallback=outcome.is_fallback,
            attempts=outcome.attempts,
        )
        return outcome

    def _compose_and_check(self, bundle: FactBundle) -> VerificationOutcome:
        """Compose, check, regenerate once, then fall back. docs/05 A4 step 5."""
        model = self.client.settings.model_narrative
        feedback: str | None = None
        last_check: SelfCheckResult | None = None

        for attempt in (1, 2):
            try:
                draft = self.compose(bundle, feedback=feedback)
            except (AgentCallError, Exception) as exc:  # noqa: BLE001 - fallback exists for this
                log.warning(
                    "a4.compose_failed",
                    entity_id=bundle.entity_id,
                    attempt=attempt,
                    error=str(exc)[:300],
                )
                break

            banned = find_banned_vocabulary(draft.narrative_md)
            if banned:
                # Caught before the self check so the failure reason is precise
                # in the logs; the self check would also catch it.
                last_check = SelfCheckResult(
                    passed=False,
                    problems=(f"The draft uses banned vocabulary {banned}.",),
                )
            else:
                last_check = run_self_check(self.client, draft.narrative_md, bundle)

            if last_check.passed:
                return VerificationOutcome(
                    bundle=bundle,
                    narrative_md=draft.narrative_md,
                    citations=tuple(c.model_dump() for c in draft.citations),
                    confidence=draft.confidence,
                    self_check_passed=True,
                    is_fallback=False,
                    model=model,
                    prompt_version=self.prompt.version,
                    attempts=attempt,
                    self_check=last_check,
                )
            feedback = last_check.as_feedback()

        return VerificationOutcome(
            bundle=bundle,
            narrative_md=render_fallback(bundle),
            citations=tuple(_fallback_citations(bundle)),
            # A mechanical rendering of the record is exactly as reliable as the
            # record. It is not "low confidence", it is unanalysed, and the UI
            # labels it as a fallback separately.
            confidence="medium" if bundle.has_any_facts else "low",
            self_check_passed=False,
            is_fallback=True,
            model=model,
            prompt_version=self.prompt.version,
            attempts=2,
            self_check=last_check,
        )


def _fallback_citations(bundle: FactBundle) -> list[dict[str, Any]]:
    citations: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for line in bundle.fiscal_facts:
        key = ("source", str(line.source_record_id))
        if key in seen:
            continue
        seen.add(key)
        citations.append(
            {"kind": "source", "ref": str(line.source_record_id), "label": f"{line.stage} figure"}
        )
    for tender in bundle.tenders:
        citations.append({"kind": "tender", "ref": tender.tender_id, "label": tender.title[:120]})
    for item in bundle.evidence:
        citations.append(
            {"kind": "evidence", "ref": str(item.evidence_id), "label": item.title[:120]}
        )
    return citations


def _host_allowed(url: str, allowlist: tuple[str, ...]) -> bool:
    lowered = url.lower()
    return any(f"//{domain}" in lowered or f".{domain}" in lowered for domain in allowlist)
