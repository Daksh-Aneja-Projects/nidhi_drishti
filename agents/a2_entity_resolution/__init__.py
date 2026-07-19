"""A2 - entity resolution. Trigram first, model for ambiguity, human below 0.9."""

from __future__ import annotations

from agents.a2_entity_resolution.agent import (
    AGENT_ID,
    MAX_CANDIDATES,
    TRIGRAM_AUTO_ACCEPT,
    TRIGRAM_MARGIN,
    EntityResolutionAgent,
    ResolutionRequest,
)
from agents.a2_entity_resolution.schema import Adjudication, Candidate, Resolution

__all__ = [
    "AGENT_ID",
    "MAX_CANDIDATES",
    "TRIGRAM_AUTO_ACCEPT",
    "TRIGRAM_MARGIN",
    "Adjudication",
    "Candidate",
    "EntityResolutionAgent",
    "Resolution",
    "ResolutionRequest",
]
