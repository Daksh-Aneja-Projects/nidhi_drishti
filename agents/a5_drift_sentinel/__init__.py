"""A5 - drift sentinel. Compares run metrics, alerts, pauses canonical writes."""

from __future__ import annotations

from agents.a5_drift_sentinel.agent import (
    AGENT_ID,
    DriftSentinel,
    SentinelVerdict,
    in_memory_sentinel,
)
from agents.a5_drift_sentinel.pause import (
    FilePauseStore,
    InMemoryPauseStore,
    PauseRecord,
    PauseStore,
)

__all__ = [
    "AGENT_ID",
    "DriftSentinel",
    "FilePauseStore",
    "InMemoryPauseStore",
    "PauseRecord",
    "PauseStore",
    "SentinelVerdict",
    "in_memory_sentinel",
]
