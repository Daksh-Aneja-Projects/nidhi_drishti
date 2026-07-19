"""A2 - entity resolution (docs/05 A2).

An unseen organisation string arrives from a tender, a PIB release or a PFMS
report. This agent decides which canonical ministry, scheme or demand it means.

The decision ladder, cheapest and most reliable first:

1. **Exact** on the normalised form. No model call, confidence 1.0.
2. **Trigram**, in SQL, against ``entity_alias`` and the reference tables. A
   single dominant candidate above :data:`TRIGRAM_AUTO_ACCEPT` is accepted
   outright, again with no model call.
3. **Model adjudication**, and only here, for the genuinely ambiguous middle:
   several plausible candidates, or one that is close but not close enough.

Anything the ladder ends with below 0.9 confidence goes to
``alias_review_queue``, never to ``entity_alias``. That threshold is the whole
point of the agent: an alias is a permanent redirection of every rupee that
flows through that name afterwards, so a coin-flip mapping is worse than none.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import structlog

from agents.a2_entity_resolution.queries import (
    CANDIDATE_SIMILARITY_FLOOR,
    CANDIDATE_SQL_BY_TYPE,
    EXISTING_ALIAS_SQL,
)
from agents.a2_entity_resolution.schema import (
    Adjudication,
    AliasEntityType,
    Candidate,
    Resolution,
)
from agents.lib.client import AgentClient
from agents.lib.config import ALIAS_AUTO_ACCEPT_CONFIDENCE
from agents.lib.db import GuardedConnection, fetch_all, queue_alias_review, upsert_entity_alias
from agents.lib.prompts import Prompt, load_prompt
from pipelines.parsers.text_norm import normalise_org_name

log = structlog.get_logger(__name__)

AGENT_ID = "A2"
PROMPT_NAME = "a2_entity_resolution"

#: A trigram score this high, with a clear gap to the runner-up, is accepted
#: without a model call. Set high on purpose: trigram similarity is blind to
#: meaning, and "Department of Higher Education" scores well against
#: "Department of School Education" while meaning something else entirely.
TRIGRAM_AUTO_ACCEPT = 0.92

#: Minimum gap between the top candidate and the second before the top one may
#: be auto-accepted. Two near-identical scores are the definition of ambiguous.
TRIGRAM_MARGIN = 0.08

#: Candidates shown to the model. More than this is noise, and the shortlist is
#: already ordered by similarity.
MAX_CANDIDATES = 8


@dataclass(frozen=True, slots=True)
class ResolutionRequest:
    raw_name: str
    entity_type: AliasEntityType
    source_id: str | None = None
    #: Free text from around the name: a tender title, a PIB headline. Helps the
    #: model separate a department from its parent ministry.
    context: str = ""


class EntityResolutionAgent:
    """docs/05 A2. Trigram shortlist in SQL, model only for ambiguity."""

    def __init__(
        self,
        client: AgentClient,
        conn: GuardedConnection,
        *,
        prompt: Prompt | None = None,
        auto_accept_confidence: float = ALIAS_AUTO_ACCEPT_CONFIDENCE,
    ) -> None:
        self.client = client
        self.conn = conn
        self.prompt = prompt or load_prompt(PROMPT_NAME)
        self.auto_accept_confidence = auto_accept_confidence

    # -- candidate generation ----------------------------------------------

    def existing_alias(self, request: ResolutionRequest) -> dict[str, Any] | None:
        rows = fetch_all(
            self.conn,
            EXISTING_ALIAS_SQL,
            {"raw_name": request.raw_name, "entity_type": request.entity_type},
        )
        return rows[0] if rows else None

    def candidates(self, request: ResolutionRequest) -> list[Candidate]:
        sql = CANDIDATE_SQL_BY_TYPE[request.entity_type]
        rows = fetch_all(
            self.conn,
            sql,
            {"raw_name": request.raw_name, "floor": CANDIDATE_SIMILARITY_FLOOR},
        )
        candidates = [
            Candidate(
                entity_id=str(row["entity_id"]),
                name=str(row["name"]),
                similarity=float(row["similarity"]),
                via=str(row.get("via", "reference")),  # type: ignore[arg-type]
            )
            for row in rows
        ]
        candidates.sort(key=lambda c: (-c.similarity, c.entity_id))
        return candidates[:MAX_CANDIDATES]

    # -- decision ladder ----------------------------------------------------

    @staticmethod
    def exact_match(raw_name: str, candidates: list[Candidate]) -> Candidate | None:
        """A candidate whose normalised name equals the normalised raw name.

        Normalisation expands "M/o", folds "&" to "and" and harmonises British
        and American spelling, so this catches the large, boring majority of
        cases without a model call and without a similarity score.
        """
        target = normalise_org_name(raw_name)
        if not target:
            return None
        for candidate in candidates:
            if normalise_org_name(candidate.name) == target:
                return candidate
        return None

    @staticmethod
    def unambiguous_trigram(candidates: list[Candidate]) -> Candidate | None:
        if not candidates:
            return None
        top = candidates[0]
        if top.similarity < TRIGRAM_AUTO_ACCEPT:
            return None
        runner_up = candidates[1].similarity if len(candidates) > 1 else 0.0
        if top.similarity - runner_up < TRIGRAM_MARGIN:
            return None
        return top

    def adjudicate(self, request: ResolutionRequest, candidates: list[Candidate]) -> Adjudication:
        system = self.prompt.render(
            raw_name=request.raw_name,
            entity_type=request.entity_type,
            source_id=request.source_id or "unknown",
            context=request.context or "(no surrounding context was captured)",
            candidates="\n".join(c.as_prompt_line() for c in candidates)
            or "(no candidate cleared the similarity floor)",
        )
        return self.client.structured(
            agent_id=AGENT_ID,
            prompt=self.prompt,
            system=system,
            user_content=(
                f"Which canonical {request.entity_type} does {request.raw_name!r} refer to? "
                "Answer with one of the candidate ids, or null."
            ),
            schema=Adjudication,
            model=self.client.settings.model_standard,
            entity_type=request.entity_type,
            entity_id=None,
        )

    # -- entry point --------------------------------------------------------

    def resolve(self, request: ResolutionRequest) -> Resolution:
        existing = self.existing_alias(request)
        if existing is not None:
            # Already mapped. Returned rather than re-decided: re-adjudicating a
            # settled alias would let a model overwrite a human's decision.
            return Resolution(
                raw_name=request.raw_name,
                entity_type=request.entity_type,
                entity_id=str(existing["entity_id"]),
                confidence=float(existing["confidence"]),
                resolved_by=(
                    existing["resolved_by"]
                    if existing["resolved_by"] in {"exact", "trigram", "agent"}
                    else "exact"
                ),
                reasoning="Alias already present in entity_alias; left untouched.",
            )

        candidates = self.candidates(request)

        exact = self.exact_match(request.raw_name, candidates)
        if exact is not None:
            return self._accept(request, exact.entity_id, 1.0, "exact", candidates,
                                "Normalised names are identical.")

        trigram = self.unambiguous_trigram(candidates)
        if trigram is not None:
            return self._accept(
                request,
                trigram.entity_id,
                round(min(trigram.similarity, 0.99), 2),
                "trigram",
                candidates,
                f"Single dominant trigram match at {trigram.similarity:.2f}.",
            )

        if not candidates:
            return self._queue(
                request,
                candidates,
                "No candidate cleared the trigram floor, so no evidence found in the "
                "reference data supports any mapping for this name.",
                confidence=0.0,
            )

        verdict = self.adjudicate(request, candidates)
        allowed = {c.entity_id for c in candidates}
        if verdict.entity_id is not None and verdict.entity_id not in allowed:
            # The model named something outside the shortlist. Treated as a
            # non-answer rather than trusted: an id we did not offer is either a
            # hallucination or a mapping nobody has vetted.
            log.warning(
                "a2.candidate_off_list",
                raw_name=request.raw_name,
                proposed=verdict.entity_id,
            )
            return self._queue(
                request,
                candidates,
                f"The adjudicator proposed {verdict.entity_id!r}, which was not on the "
                f"candidate list, so the name is queued for a human.",
                confidence=0.0,
            )

        if verdict.entity_id is None or verdict.confidence < self.auto_accept_confidence:
            return self._queue(request, candidates, verdict.reasoning, verdict.confidence)

        return self._accept(
            request,
            verdict.entity_id,
            verdict.confidence,
            "agent",
            candidates,
            verdict.reasoning,
        )

    # -- writes -------------------------------------------------------------

    def _accept(
        self,
        request: ResolutionRequest,
        entity_id: str,
        confidence: float,
        resolved_by: str,
        candidates: list[Candidate],
        reasoning: str,
    ) -> Resolution:
        if confidence < self.auto_accept_confidence:  # pragma: no cover - guarded by callers
            return self._queue(request, candidates, reasoning, confidence)
        upsert_entity_alias(
            self.conn,
            {
                "alias": request.raw_name,
                "entity_type": request.entity_type,
                "entity_id": entity_id,
                "source_id": request.source_id,
                "confidence": round(confidence, 2),
                "resolved_by": resolved_by,
            },
        )
        log.info(
            "a2.alias_written",
            raw_name=request.raw_name,
            entity_id=entity_id,
            confidence=confidence,
            resolved_by=resolved_by,
        )
        return Resolution(
            raw_name=request.raw_name,
            entity_type=request.entity_type,
            entity_id=entity_id,
            confidence=confidence,
            resolved_by=resolved_by,  # type: ignore[arg-type]
            reasoning=reasoning,
            candidates=tuple(candidates),
        )

    def _queue(
        self,
        request: ResolutionRequest,
        candidates: list[Candidate],
        reasoning: str,
        confidence: float,
    ) -> Resolution:
        queue_alias_review(
            self.conn,
            {
                "raw_name": request.raw_name,
                "entity_type": request.entity_type,
                "source_id": request.source_id,
                "suggestions": [
                    {
                        "entity_id": c.entity_id,
                        "name": c.name,
                        "similarity": round(c.similarity, 3),
                        "via": c.via,
                    }
                    for c in candidates
                ],
            },
        )
        log.info(
            "a2.queued_for_review",
            raw_name=request.raw_name,
            candidate_count=len(candidates),
            confidence=confidence,
        )
        return Resolution(
            raw_name=request.raw_name,
            entity_type=request.entity_type,
            entity_id=None,
            confidence=confidence,
            resolved_by="queued",
            reasoning=reasoning,
            candidates=tuple(candidates),
        )
