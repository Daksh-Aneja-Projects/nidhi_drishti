"""The Nidhi Drishti agent layer (docs/05).

Six agents sit on top of the canonical store. None of them may write a fiscal
figure. That rule is enforced structurally by :mod:`agents.lib.db`, which routes
every statement through a write guard whose allowlist does not contain
``fiscal_fact`` (or any other table the pipelines own).
"""

from __future__ import annotations

__all__ = ["AGENT_IDS"]

#: Agent ids as they appear in ``agent_call.agent_id``.
AGENT_IDS: tuple[str, ...] = ("A1", "A2", "A3", "A4", "A5", "A6")
