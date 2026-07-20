"""Prompt loading and versioning.

``prompt_version`` is derived from the SHA-256 of the prompt file's bytes, not
from a number a human maintains. A hand-maintained version drifts the moment
someone fixes a typo without bumping it, and from then on the ``agent_call`` and
``verification_report`` rows name a version whose text nobody can reconstruct.
A content hash cannot drift from the content it names.

Every prompt is also validated on load: it must carry the shared guardrails
(docs/08 section 2), because a prompt that forgets to forbid the accusatory
vocabulary is a publishing-posture bug, and it should fail at import time rather
than in front of a reader.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

PROMPT_DIR = Path(__file__).resolve().parents[1] / "prompts"

#: Words that may never appear in product copy about a flag (docs/08 section 2).
#: We publish data and methodology, not accusations.
BANNED_VOCABULARY: tuple[str, ...] = (
    "scam",
    "fraud",
    "fraudulent",
    "siphon",
    "siphoned",
    "siphoning",
    "corrupt",
    "corruption",
    "embezzle",
    "embezzled",
    "embezzlement",
    "loot",
    "looted",
    "misappropriat",
)

#: Substrings every prompt file must contain. The first is the "say nothing
#: rather than infer" instruction; the second is the banned-vocabulary rule.
#: Checked on load so a prompt cannot quietly lose its guardrails.
REQUIRED_PROMPT_MARKERS: tuple[str, ...] = (
    "no evidence found",
    "Never use the words",
)

_WORD_BOUNDARY_CACHE: dict[str, re.Pattern[str]] = {}


class PromptError(RuntimeError):
    """Raised when a prompt file is missing or fails its guardrail check."""


@dataclass(frozen=True, slots=True)
class Prompt:
    """One loaded prompt file plus the version derived from its content."""

    name: str
    text: str
    sha256: str
    path: Path

    @property
    def version(self) -> str:
        """The value stored in ``prompt_version``, e.g. ``a4_narrative@1f3c9a2b4d5e``.

        Twelve hex characters is 48 bits: ample for a repository that will hold
        tens of prompts, and short enough to read in an admin table.
        """
        return f"{self.name}@{self.sha256[:12]}"

    def render(self, **values: object) -> str:
        """Substitute ``{{placeholder}}`` markers.

        A deliberately tiny templating scheme. Jinja would let a prompt grow
        control flow, and a prompt with control flow is a prompt whose hash no
        longer describes what the model actually saw.
        """
        text = self.text
        for key, value in values.items():
            marker = "{{" + key + "}}"
            if marker not in text:
                raise PromptError(f"Prompt {self.name!r} has no placeholder {marker}.")
            text = text.replace(marker, str(value))
        leftover = re.findall(r"\{\{([a-z_][a-z0-9_]*)\}\}", text)
        if leftover:
            raise PromptError(
                f"Prompt {self.name!r} still has unfilled placeholders: {sorted(set(leftover))}."
            )
        return text


def validate_prompt_text(name: str, text: str) -> None:
    # Whitespace-collapsed, because a prompt is prose and a guardrail sentence
    # that happens to wrap across two lines is still the guardrail sentence.
    flattened = " ".join(text.split())
    missing = [marker for marker in REQUIRED_PROMPT_MARKERS if marker not in flattened]
    if missing:
        raise PromptError(
            f"Prompt {name!r} is missing the mandatory guardrail text {missing}. Every prompt "
            f"must tell the model to state 'no evidence found' rather than infer, and must "
            f"forbid the accusatory vocabulary listed in docs/08 section 2."
        )


@lru_cache(maxsize=64)
def load_prompt(name: str, *, prompt_dir: str | None = None) -> Prompt:
    """Load ``<name>.md`` from agents/prompts and hash it.

    Cached: the hash is only meaningful if it describes the bytes the process is
    actually sending, and re-reading on every call would let a mid-run edit
    produce two different prompts under one recorded version.
    """
    directory = Path(prompt_dir) if prompt_dir else PROMPT_DIR
    path = directory / f"{name}.md"
    if not path.exists():
        raise PromptError(f"No prompt file at {path}.")
    raw = path.read_bytes()
    text = raw.decode("utf-8")
    validate_prompt_text(name, text)
    return Prompt(
        name=name,
        text=text,
        sha256=hashlib.sha256(raw).hexdigest(),
        path=path,
    )


def all_prompt_names(*, prompt_dir: str | None = None) -> list[str]:
    directory = Path(prompt_dir) if prompt_dir else PROMPT_DIR
    return sorted(p.stem for p in directory.glob("*.md"))


def _pattern_for(term: str) -> re.Pattern[str]:
    pattern = _WORD_BOUNDARY_CACHE.get(term)
    if pattern is None:
        # Prefix terms such as "siphon" and "misappropriat" intentionally match
        # their inflections, so only a leading boundary is required.
        pattern = re.compile(rf"\b{re.escape(term)}", re.IGNORECASE)
        _WORD_BOUNDARY_CACHE[term] = pattern
    return pattern


def find_banned_vocabulary(text: str) -> list[str]:
    """Banned words present in model output, in the order they are declared.

    Applied to generated explanations and narratives before anything is written.
    A flag that reads as an accusation is a legal exposure, and the cheapest
    place to catch one is between the model and the database.
    """
    hits: list[str] = []
    for term in BANNED_VOCABULARY:
        if _pattern_for(term).search(text) and term not in hits:
            hits.append(term)
    return hits


def assert_publishable(text: str, *, context: str = "output") -> str:
    """Return ``text`` unchanged, or raise if it uses accusatory vocabulary."""
    hits = find_banned_vocabulary(text)
    if hits:
        raise PromptError(
            f"Refusing to store {context}: it uses the vocabulary docs/08 section 2 bans "
            f"({hits}). Approved framing describes the measurement, not a motive."
        )
    return text
