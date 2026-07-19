"""A4 step 5: the self check that kills hallucinated figures.

Two independent passes, and a narrative has to survive both:

1. **Deterministic.** Every quantity in the markdown is extracted and matched
   against :meth:`FactBundle.allowed_values`. No model involved, so it cannot be
   talked out of a finding. This catches the failure that matters most, which is
   a number that is nearly right.
2. **Model.** A second call re-reads the narrative against the facts and looks
   for what a regular expression cannot see: a RELEASE figure described as
   expenditure, an activity claim with no evidence behind it, an implication of
   wrongdoing.

Belt and braces on purpose. The deterministic pass is not fooled but is blind to
meaning; the model pass reads meaning but can be persuaded. Requiring both to
pass means either one can save the page.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

import structlog
from pydantic import BaseModel, ConfigDict, Field

from agents.a4_verification.facts import FactBundle
from agents.lib.client import AgentCallError, AgentClient
from agents.lib.numbers import NumberMention, unsupported_numbers
from agents.lib.prompts import Prompt, find_banned_vocabulary, load_prompt

log = structlog.get_logger(__name__)

AGENT_ID = "A4"
SELF_CHECK_PROMPT_NAME = "a4_self_check"


class SelfCheckVerdict(BaseModel):
    """The checking model's answer."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    passed: bool
    problems: list[str] = Field(default_factory=list)


@dataclass(frozen=True, slots=True)
class SelfCheckResult:
    """Combined verdict of both passes."""

    passed: bool
    problems: tuple[str, ...] = ()
    unsupported: tuple[NumberMention, ...] = ()
    #: True when the model pass could not be run at all. A failed check is a
    #: failed narrative: the fallback rendering is always available, so there is
    #: never a reason to publish an unverified narrative instead.
    model_pass_errored: bool = False
    details: dict[str, bool] = field(default_factory=dict)

    def as_feedback(self) -> str:
        """The correction handed back to the writer on the single retry."""
        lines = ["The previous draft failed its self check for these reasons:"]
        lines.extend(f"- {problem}" for problem in self.problems)
        lines.append(
            "Rewrite it. Use only figures that appear verbatim in the facts you were given, "
            "and if a figure you want does not exist there, describe the relationship in words "
            "instead of computing it."
        )
        return "\n".join(lines)


def deterministic_check(narrative: str, bundle: FactBundle) -> SelfCheckResult:
    """The pass that cannot be argued with."""
    problems: list[str] = []

    stray = unsupported_numbers(narrative, bundle.allowed_values())
    for mention in stray:
        problems.append(
            f"The figure {mention.raw!r} does not appear in the facts provided "
            f"(context: ...{mention.context}...)."
        )

    banned = find_banned_vocabulary(narrative)
    if banned:
        problems.append(
            f"The narrative uses vocabulary docs/08 section 2 bans: {banned}. "
            f"Describe the measurement, not a motive."
        )

    if "—" in narrative or "–" in narrative:
        problems.append("The narrative contains an em-dash or en-dash, which product copy bans.")

    return SelfCheckResult(
        passed=not problems,
        problems=tuple(problems),
        unsupported=tuple(stray),
        details={"deterministic": not problems},
    )


def model_check(
    client: AgentClient,
    narrative: str,
    bundle: FactBundle,
    *,
    prompt: Prompt | None = None,
    model: str | None = None,
) -> tuple[SelfCheckVerdict | None, str | None]:
    """The second call. Returns ``(verdict, error)``; exactly one is not None."""
    resolved_prompt = prompt or load_prompt(SELF_CHECK_PROMPT_NAME)
    payload = bundle.as_check_payload()
    system = resolved_prompt.render(
        facts=_render_payload(payload),
        narrative=narrative,
    )
    try:
        verdict = client.structured(
            agent_id=AGENT_ID,
            prompt=resolved_prompt,
            system=system,
            user_content="Check the narrative against the facts and return your verdict.",
            schema=SelfCheckVerdict,
            # The fast model is enough: this is a comparison task against a
            # short, closed list, not an analysis task.
            model=model or client.settings.model_fast,
            entity_type=bundle.entity_type,
            entity_id=bundle.entity_id,
        )
    except (AgentCallError, Exception) as exc:  # noqa: BLE001 - never crash the page
        return None, f"{type(exc).__name__}: {exc}"
    return verdict, None


def run_self_check(
    client: AgentClient,
    narrative: str,
    bundle: FactBundle,
    *,
    prompt: Prompt | None = None,
    model: str | None = None,
) -> SelfCheckResult:
    """Both passes. Passes only if both pass."""
    deterministic = deterministic_check(narrative, bundle)
    verdict, error = model_check(client, narrative, bundle, prompt=prompt, model=model)

    problems = list(deterministic.problems)
    model_passed = False
    if verdict is None:
        problems.append(
            f"The self-check call could not be completed ({error}), so the narrative is "
            f"unverified and is not published."
        )
    else:
        model_passed = verdict.passed
        if not verdict.passed:
            problems.extend(verdict.problems or ["The checking model reported a failure."])

    passed = deterministic.passed and model_passed
    if not passed:
        log.warning(
            "a4.self_check_failed",
            entity_id=bundle.entity_id,
            fy=bundle.fy,
            deterministic_passed=deterministic.passed,
            model_passed=model_passed,
            problem_count=len(problems),
        )
    return SelfCheckResult(
        passed=passed,
        problems=tuple(problems),
        unsupported=deterministic.unsupported,
        model_pass_errored=verdict is None,
        details={"deterministic": deterministic.passed, "model": model_passed},
    )


def _render_payload(payload: dict[str, object]) -> str:
    lines: list[str] = []
    for key, value in payload.items():
        if isinstance(value, list):
            lines.append(f"{key}:")
            if value:
                lines.extend(f"  {item}" for item in value)
            else:
                lines.append("  (none)")
        elif isinstance(value, dict):
            lines.append(f"{key}:")
            if value:
                lines.extend(f"  {k}: {v}" for k, v in value.items())
            else:
                lines.append("  (none)")
        else:
            lines.append(f"{key}: {value}")
    return "\n".join(lines)


def allowed_values_summary(bundle: FactBundle) -> list[str]:
    """Human-readable list of permitted quantities, for debugging a failure."""
    return sorted(str(value) for value in bundle.allowed_values() if isinstance(value, Decimal))
