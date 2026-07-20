"""A3 - anomaly detection (docs/05 A3).

The division of labour is the entire design:

* **SQL** measures. **Python** applies fixed thresholds. Between them they decide
  whether a flag exists, and the model has no vote.
* **The model** writes the sentence a reader sees, from the numbers the rule
  already computed, and nothing else.

Every flag is written with ``status='pending'``. Nothing this agent produces is
public until a human approves it in the admin UI.

If the model call fails, returns accusatory vocabulary, or states a figure the
rule did not measure, the flag is still written, with a deterministic
explanation assembled from the rule's own description. A flag is a measurement;
losing it because a language model had a bad minute would be the wrong trade.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

import structlog
from pydantic import BaseModel, ConfigDict, Field

from agents.a3_anomaly.queries import (
    FLAG_EVIDENCE_SQL,
    MINISTRY_MEASURES_SQL,
    MONTHLY_HISTORY_SQL,
    MONTHLY_SPEND_SQL,
    NATIONAL_MEASURES_SQL,
    SCHEME_AUTHORITY_SQL,
    SCHEME_MEASURES_SQL,
)
from agents.a3_anomaly.rules import (
    INITIAL_STATUS,
    Measures,
    RuleHit,
    evaluate,
    rule_descriptions,
)
from agents.lib.client import AgentCallError, AgentClient
from agents.lib.db import GuardedConnection, fetch_all, link_flag_evidence, upsert_anomaly_flag
from agents.lib.numbers import collect_allowed_values, unsupported_numbers
from agents.lib.prompts import Prompt, find_banned_vocabulary, load_prompt

log = structlog.get_logger(__name__)

AGENT_ID = "A3"
PROMPT_NAME = "a3_explanation"

#: Evidence items offered to the explanation model per flag.
EVIDENCE_LIMIT = 6


class Explanation(BaseModel):
    """The model's contribution: prose, and which evidence it cited."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    explanation: str = Field(min_length=20, max_length=1200)
    cited_evidence_ids: list[int] = Field(default_factory=list)


@dataclass(frozen=True, slots=True)
class FlagOutcome:
    """One written flag, and how its explanation was produced."""

    measures: Measures
    hit: RuleHit
    explanation: str
    #: True when the deterministic template was used because the model call
    #: failed or its output was rejected.
    explanation_is_fallback: bool
    cited_evidence_ids: tuple[int, ...]
    flag_id: int | None = None


def _decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(value))


def _fallback_explanation(hit: RuleHit) -> str:
    """A correct, dull explanation assembled from the rule itself.

    Contains only figures the rule measured, carries the mandatory limitation
    sentence, and uses no vocabulary a lawyer would object to. It is what the
    reader sees whenever the model's version cannot be trusted.
    """
    return f"{hit.description} {hit.does_not_show}"


class AnomalyAgent:
    """docs/05 A3. Rules decide, the model narrates, a human approves."""

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
        self._descriptions = rule_descriptions()

    # -- measurement --------------------------------------------------------

    def load_measures(self, fy: str) -> list[Measures]:
        """Build one :class:`Measures` per entity for the fiscal year.

        Reads the same materialised views the dashboard reads, so a flag and the
        chart next to it can never disagree.
        """
        rows: list[dict[str, Any]] = []
        rows.extend(fetch_all(self.conn, NATIONAL_MEASURES_SQL, {"fy": fy}))
        rows.extend(fetch_all(self.conn, MINISTRY_MEASURES_SQL, {"fy": fy}))
        rows.extend(fetch_all(self.conn, SCHEME_MEASURES_SQL, {"fy": fy}))

        scheme_authority = {
            str(row["entity_id"]): row
            for row in fetch_all(self.conn, SCHEME_AUTHORITY_SQL, {"fy": fy})
        }
        monthly = self._monthly_by_entity(MONTHLY_SPEND_SQL, fy)
        history = self._history_by_entity(fy)

        measures: list[Measures] = []
        for row in rows:
            key = (str(row["entity_type"]), str(row["entity_id"]))
            months = monthly.get(key, {})
            be, re_ = _decimal(row.get("be")), _decimal(row.get("re"))
            if row["entity_type"] == "scheme":
                authority = scheme_authority.get(str(row["entity_id"]))
                if authority is not None:
                    be = _decimal(authority.get("be"))
                    re_ = _decimal(authority.get("re"))
            measures.append(
                Measures(
                    entity_type=row["entity_type"],
                    entity_id=str(row["entity_id"]),
                    entity_label=str(row["entity_label"]),
                    fy=str(row["fy"]),
                    be=be,
                    re=re_,
                    supplementary=_decimal(row.get("supplementary")),
                    current_authority=_decimal(row.get("current_authority")),
                    expenditure_to_date=_decimal(row.get("expenditure_to_date")),
                    expenditure_as_of=_as_date(row.get("expenditure_as_of")),
                    pct_fy_elapsed=_decimal(row.get("pct_fy_elapsed")),
                    burn_ratio=_decimal(row.get("burn_ratio")),
                    capital_expenditure=_decimal(row.get("capital_expenditure")),
                    released=_decimal(row.get("released")),
                    monthly_amounts=months,
                    months_reported=len(months),
                    monthly_history=history.get(key, {}),
                    latest_month_index=max(months) if months else None,
                    tender_count_trailing_90d=(
                        int(row["tender_count_trailing_90d"])
                        if row.get("tender_count_trailing_90d") is not None
                        else None
                    ),
                )
            )
        return measures

    def _monthly_by_entity(self, sql: str, fy: str) -> dict[tuple[str, str], dict[int, Decimal]]:
        out: dict[tuple[str, str], dict[int, Decimal]] = defaultdict(dict)
        for row in fetch_all(self.conn, sql, {"fy": fy}):
            key = (str(row["entity_type"]), str(row["entity_id"]))
            amount = _decimal(row["monthly_amount"])
            if amount is not None:
                out[key][int(row["fiscal_month_index"])] = amount
        return dict(out)

    def _history_by_entity(self, fy: str) -> dict[tuple[str, str], dict[int, list[Decimal]]]:
        out: dict[tuple[str, str], dict[int, list[Decimal]]] = defaultdict(
            lambda: defaultdict(list)
        )
        for row in fetch_all(self.conn, MONTHLY_HISTORY_SQL, {"fy": fy}):
            key = (str(row["entity_type"]), str(row["entity_id"]))
            amount = _decimal(row["monthly_amount"])
            if amount is not None:
                out[key][int(row["fiscal_month_index"])].append(amount)
        return {key: dict(value) for key, value in out.items()}

    # -- explanation --------------------------------------------------------

    def evidence_for(self, measures: Measures) -> list[dict[str, Any]]:
        if measures.entity_type == "national":
            return []
        return fetch_all(
            self.conn,
            FLAG_EVIDENCE_SQL,
            {
                "fy": measures.fy,
                "entity_type": measures.entity_type,
                "entity_id": measures.entity_id,
                "limit": EVIDENCE_LIMIT,
            },
        )

    def explain(
        self, measures: Measures, hit: RuleHit, evidence: list[dict[str, Any]]
    ) -> tuple[str, tuple[int, ...], bool]:
        """Return ``(explanation, cited_evidence_ids, is_fallback)``.

        Three checks stand between the model and the database: the vocabulary
        ban from docs/08, the rule that every number must be one the rule
        measured, and the requirement that a citation point at evidence we
        actually offered. Failing any of them costs the flag its prose, not its
        existence.
        """
        metric = hit.metric_with_limits()
        evidence_lines = (
            "\n".join(
                f"- [evidence:{item['evidence_id']}] {item['kind']} "
                f"{item.get('published_date') or 'undated'}: {item['title']}"
                for item in evidence
            )
            or "(no evidence items were indexed for this entity and period)"
        )
        system = self.prompt.render(
            rule_id=hit.rule_id,
            entity_label=measures.entity_label,
            entity_type=measures.entity_type,
            entity_id=measures.entity_id,
            fy=measures.fy,
            metric=_pretty(metric),
            rule_description=self._descriptions.get(hit.rule_id, hit.description),
            evidence=evidence_lines,
        )
        try:
            answer = self.client.structured(
                agent_id=AGENT_ID,
                prompt=self.prompt,
                system=system,
                user_content="Write the explanation for this flag.",
                schema=Explanation,
                model=self.client.settings.model_standard,
                entity_type=measures.entity_type,
                entity_id=measures.entity_id,
            )
        except (AgentCallError, Exception) as exc:  # noqa: BLE001 - a flag must survive this
            log.warning(
                "a3.explanation_failed",
                rule_id=hit.rule_id,
                entity_id=measures.entity_id,
                error=str(exc)[:300],
            )
            return _fallback_explanation(hit), (), True

        rejection = self._reject_reason(answer, hit, evidence)
        if rejection is not None:
            log.warning(
                "a3.explanation_rejected",
                rule_id=hit.rule_id,
                entity_id=measures.entity_id,
                reason=rejection,
            )
            return _fallback_explanation(hit), (), True

        return answer.explanation.strip(), tuple(answer.cited_evidence_ids), False

    def _reject_reason(
        self, answer: Explanation, hit: RuleHit, evidence: list[dict[str, Any]]
    ) -> str | None:
        banned = find_banned_vocabulary(answer.explanation)
        if banned:
            return f"accusatory vocabulary {banned}"
        allowed = collect_allowed_values(hit.metric_with_limits())
        # The rule's own description is generated deterministically from the
        # same measurement, and renders fractions as percentages. A model that
        # quotes "75.0 percent" where the metric holds 0.7500 is quoting the
        # rule, not inventing a figure, so both forms are permitted.
        allowed |= collect_allowed_values(hit.description)
        allowed |= {Decimal(100)}
        stray = unsupported_numbers(answer.explanation, allowed)
        if stray:
            return f"figures not in the measured metric: {[m.raw for m in stray][:5]}"
        offered = {int(item["evidence_id"]) for item in evidence}
        invented = [cid for cid in answer.cited_evidence_ids if cid not in offered]
        if invented:
            return f"citations to evidence that was not offered: {invented}"
        return None

    # -- entry point --------------------------------------------------------

    def run(self, fy: str, *, write: bool = True) -> list[FlagOutcome]:
        """Evaluate every entity for ``fy`` and write the flags it finds.

        ``write=False`` gives a dry run for the eval harness and for the admin
        preview, which is how a threshold change gets reviewed before it starts
        creating review-queue work.
        """
        outcomes: list[FlagOutcome] = []
        for measures in self.load_measures(fy):
            hits = evaluate(measures)
            if not hits:
                continue
            evidence = self.evidence_for(measures)
            for hit in hits:
                explanation, cited, is_fallback = self.explain(measures, hit, evidence)
                flag_id: int | None = None
                if write:
                    flag_id = upsert_anomaly_flag(
                        self.conn,
                        {
                            "rule_id": hit.rule_id,
                            "entity_type": measures.entity_type,
                            "entity_id": measures.entity_id,
                            "fy": measures.fy,
                            "severity": hit.severity,
                            "metric": hit.metric_with_limits(),
                            "explanation": explanation,
                            "status": INITIAL_STATUS,
                        },
                    )
                    if cited:
                        link_flag_evidence(self.conn, flag_id, cited)
                outcomes.append(
                    FlagOutcome(
                        measures=measures,
                        hit=hit,
                        explanation=explanation,
                        explanation_is_fallback=is_fallback,
                        cited_evidence_ids=cited,
                        flag_id=flag_id,
                    )
                )
        log.info(
            "a3.run_complete",
            fy=fy,
            flags=len(outcomes),
            fallback_explanations=sum(1 for o in outcomes if o.explanation_is_fallback),
            written=write,
        )
        return outcomes


def _as_date(value: Any) -> date | None:
    if value is None or isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def _pretty(metric: dict[str, Any]) -> str:
    return "\n".join(f"- {key}: {value}" for key, value in metric.items())
