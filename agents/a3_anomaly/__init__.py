"""A3 - anomaly detection. Deterministic rules; the model only writes prose."""

from __future__ import annotations

from agents.a3_anomaly.agent import AGENT_ID, AnomalyAgent, Explanation, FlagOutcome
from agents.a3_anomaly.rules import (
    ALL_RULES,
    INITIAL_STATUS,
    Measures,
    RuleHit,
    evaluate,
    rule_descriptions,
)

__all__ = [
    "AGENT_ID",
    "ALL_RULES",
    "INITIAL_STATUS",
    "AnomalyAgent",
    "Explanation",
    "FlagOutcome",
    "Measures",
    "RuleHit",
    "evaluate",
    "rule_descriptions",
]
