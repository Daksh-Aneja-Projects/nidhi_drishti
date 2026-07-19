"""Shared machinery for the agent layer: config, guarded DB access, prompts, client."""

from __future__ import annotations

from agents.lib.client import (
    AgentCallError,
    AgentCallRecord,
    AgentClient,
    DatabaseCallLogger,
    MemoryCallLogger,
    StructuredOutputError,
)
from agents.lib.config import AgentSettings, get_agent_settings, load_agent_settings
from agents.lib.db import (
    ALLOWED_WRITE_TABLES,
    FiscalWriteForbidden,
    assert_write_allowed,
    connect,
)
from agents.lib.prompts import Prompt, assert_publishable, find_banned_vocabulary, load_prompt

__all__ = [
    "ALLOWED_WRITE_TABLES",
    "AgentCallError",
    "AgentCallRecord",
    "AgentClient",
    "AgentSettings",
    "DatabaseCallLogger",
    "FiscalWriteForbidden",
    "MemoryCallLogger",
    "Prompt",
    "StructuredOutputError",
    "assert_publishable",
    "assert_write_allowed",
    "connect",
    "find_banned_vocabulary",
    "get_agent_settings",
    "load_agent_settings",
    "load_prompt",
]
