"""Settings for the agent layer.

Deliberately thin: everything that is not agent-specific is delegated to
``pipelines.lib.config``, which is the single place that reads ``.env``. A second
definition of ``DATABASE_URL`` in this package would eventually disagree with the
first, and the two halves of the system would be looking at different databases
while both claiming to be correct.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from pipelines.lib.config import REPO_ROOT, ConfigError, Settings, load_settings

#: Domains a live web search may touch (docs/05 A4 step 3, docs/08 section 1).
#: Government primary sources plus a small set of established business press.
#: The allowlist is a compliance control, not a tuning knob: widening it means
#: the verification narrative can cite a source we have not vetted.
DEFAULT_WEB_SEARCH_ALLOWLIST: tuple[str, ...] = (
    "pib.gov.in",
    "indiabudget.gov.in",
    "cga.nic.in",
    "pfms.nic.in",
    "sansad.in",
    "eprocure.gov.in",
    "rbi.org.in",
    "thehindu.com",
    "indianexpress.com",
    "business-standard.com",
    "livemint.com",
    "thehindubusinessline.com",
    "economictimes.indiatimes.com",
    "reuters.com",
)

#: Below this the A2 resolver refuses to write an alias and queues it instead
#: (docs/05 A2). Named here rather than inline so the number appears exactly
#: once in the codebase.
ALIAS_AUTO_ACCEPT_CONFIDENCE = 0.9


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _env_bool(name: str, default: bool) -> bool:
    raw = _env(name)
    if raw == "":
        return default
    return raw.lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = _env(name)
    if raw == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:  # pragma: no cover - configuration typo
        raise ConfigError(f"{name} must be an integer, got {raw!r}") from exc


#: Providers the agent layer can talk to. ``ollama`` runs a local Llama model
#: with no API key and no data leaving the machine, and is the default so a
#: public deployment needs nothing bought or configured to generate. ``anthropic``
#: remains available for a hosted deployment or for the live web-search step,
#: which has no local equivalent.
AGENT_PROVIDERS: tuple[str, ...] = ("ollama", "anthropic")

DEFAULT_PROVIDER = "ollama"

#: Model defaults per provider. The Anthropic tier names are the hosted models;
#: the Ollama tier names are local Llama tags. A single ``llama3.1:8b`` covers
#: all three tiers out of the box so one `ollama pull` is enough to run; a
#: deployment with the VRAM to spare can point the narrative tier at a larger
#: tag (e.g. ``llama3.1:70b``) in .env without touching code.
_MODEL_DEFAULTS: dict[str, dict[str, str]] = {
    "ollama": {
        "fast": "llama3.1:8b",
        "standard": "llama3.1:8b",
        "narrative": "llama3.1:8b",
    },
    "anthropic": {
        "fast": "claude-haiku-4-5",
        "standard": "claude-sonnet-5",
        "narrative": "claude-opus-4-8",
    },
}


@dataclass(frozen=True, slots=True)
class AgentSettings:
    """Agent-layer configuration, mirroring the ``# Agents`` block of .env.example."""

    anthropic_api_key: str
    model_fast: str
    model_standard: str
    model_narrative: str
    enable_web_search: bool
    web_search_allowlist: tuple[str, ...]
    max_output_tokens: int
    state_dir: Path
    base: Settings
    provider: str = DEFAULT_PROVIDER
    ollama_base_url: str = "http://localhost:11434"
    ollama_num_ctx: int = 8192

    @property
    def database_url(self) -> str:
        return self.base.database_url

    @property
    def has_api_key(self) -> bool:
        return bool(self.anthropic_api_key)

    def web_search_tool(self, *, max_uses: int = 5) -> dict[str, object]:
        """The server-side web-search tool definition, or raise if disabled.

        Callers must check :attr:`enable_web_search` first. Raising rather than
        silently returning an unrestricted tool means a misconfiguration shows
        up as a failed run, not as an uncited claim on a public page.
        """
        if not self.enable_web_search:
            raise ConfigError(
                "Live web search is off. Set AGENT_ENABLE_WEB_SEARCH=true to enable it; "
                "it stays off by default because every fetched page becomes a citation."
            )
        if not self.web_search_allowlist:
            raise ConfigError("Web search is enabled but the domain allowlist is empty.")
        return {
            "type": "web_search_20260209",
            "name": "web_search",
            "max_uses": max_uses,
            "allowed_domains": list(self.web_search_allowlist),
        }


def load_agent_settings(*, env_file: str | os.PathLike[str] | None = None) -> AgentSettings:
    base = load_settings(env_file=env_file)
    raw_allowlist = _env("AGENT_WEB_SEARCH_ALLOWLIST")
    allowlist = (
        tuple(item.strip().lower() for item in raw_allowlist.split(",") if item.strip())
        if raw_allowlist
        else DEFAULT_WEB_SEARCH_ALLOWLIST
    )
    provider = _env("AGENT_PROVIDER", DEFAULT_PROVIDER).lower()
    if provider not in AGENT_PROVIDERS:
        raise ConfigError(f"AGENT_PROVIDER must be one of {AGENT_PROVIDERS}, got {provider!r}.")
    # Model defaults follow the provider, so switching AGENT_PROVIDER=ollama does
    # not also require overriding three model names. An explicit AGENT_MODEL_*
    # still wins, which is how a deployment points a tier at a bigger local tag.
    tiers = _MODEL_DEFAULTS[provider]
    return AgentSettings(
        anthropic_api_key=_env("ANTHROPIC_API_KEY"),
        model_fast=_env("AGENT_MODEL_FAST", tiers["fast"]),
        model_standard=_env("AGENT_MODEL_STANDARD", tiers["standard"]),
        model_narrative=_env("AGENT_MODEL_NARRATIVE", tiers["narrative"]),
        # Off by default. docs/05 A4 step 3 makes live search optional, and an
        # accidental default-on would let a narrative cite a page nobody vetted.
        # The ollama provider has no web search at all and rejects the tool.
        enable_web_search=_env_bool("AGENT_ENABLE_WEB_SEARCH", False),
        web_search_allowlist=allowlist,
        max_output_tokens=_env_int("AGENT_MAX_OUTPUT_TOKENS", 8000),
        state_dir=Path(_env("AGENT_STATE_DIR", str(REPO_ROOT / ".agent-state"))),
        base=base,
        provider=provider,
        ollama_base_url=_env("AGENT_OLLAMA_BASE_URL", "http://localhost:11434"),
        ollama_num_ctx=_env_int("AGENT_OLLAMA_NUM_CTX", 8192),
    )


@lru_cache(maxsize=1)
def get_agent_settings() -> AgentSettings:
    """Process-wide agent settings, loaded once.

    Tests build an :class:`AgentSettings` directly rather than mutating this.
    """
    return load_agent_settings()
