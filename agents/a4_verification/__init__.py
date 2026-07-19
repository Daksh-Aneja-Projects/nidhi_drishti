"""A4 - verification narratives, with a self check that kills invented figures."""

from __future__ import annotations

from agents.a4_verification.agent import (
    AGENT_ID,
    Citation,
    NarrativeDraft,
    VerificationAgent,
    VerificationOutcome,
)
from agents.a4_verification.facts import (
    EvidenceLine,
    FactBundle,
    FactLine,
    TenderLine,
    compute_derived,
)
from agents.a4_verification.fallback import render_fallback
from agents.a4_verification.self_check import (
    SelfCheckResult,
    SelfCheckVerdict,
    deterministic_check,
    run_self_check,
)

__all__ = [
    "AGENT_ID",
    "Citation",
    "EvidenceLine",
    "FactBundle",
    "FactLine",
    "NarrativeDraft",
    "SelfCheckResult",
    "SelfCheckVerdict",
    "TenderLine",
    "VerificationAgent",
    "VerificationOutcome",
    "compute_derived",
    "deterministic_check",
    "render_fallback",
    "run_self_check",
]
