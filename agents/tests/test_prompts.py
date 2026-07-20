"""Prompt loading, versioning and the vocabulary guard.

The property being protected: ``prompt_version`` can never name a prompt other
than the one that produced the output. It is a hash of the file, so the only way
to change the version is to change the text, and the only way to change the text
is to change the version.
"""

from __future__ import annotations

import pytest

from agents.lib.prompts import (
    BANNED_VOCABULARY,
    PROMPT_DIR,
    PromptError,
    all_prompt_names,
    assert_publishable,
    find_banned_vocabulary,
    load_prompt,
    validate_prompt_text,
)

GUARDRAILS = (
    "State no evidence found rather than infer. "
    "Never use the words scam, fraud, siphoned or corrupt."
)


def write_prompt(directory, name: str, body: str) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{name}.md").write_text(body, encoding="utf-8")


def test_version_is_derived_from_content(tmp_path) -> None:
    write_prompt(tmp_path, "p", f"Version A. {GUARDRAILS}")
    first = load_prompt("p", prompt_dir=str(tmp_path))
    assert first.version.startswith("p@")
    assert len(first.version.split("@")[1]) == 12

    load_prompt.cache_clear()
    write_prompt(tmp_path, "p", f"Version B, one word changed. {GUARDRAILS}")
    second = load_prompt("p", prompt_dir=str(tmp_path))

    assert second.version != first.version, (
        "editing a prompt must change its version, otherwise a stored prompt_version "
        "names text nobody can reconstruct"
    )


def test_version_is_stable_for_identical_content(tmp_path) -> None:
    write_prompt(tmp_path, "a", f"Same bytes. {GUARDRAILS}")
    first = load_prompt("a", prompt_dir=str(tmp_path))
    load_prompt.cache_clear()
    write_prompt(tmp_path, "a", f"Same bytes. {GUARDRAILS}")
    assert load_prompt("a", prompt_dir=str(tmp_path)).version == first.version


def test_a_prompt_without_guardrails_will_not_load(tmp_path) -> None:
    load_prompt.cache_clear()
    write_prompt(tmp_path, "bad", "Summarise the page. Be helpful.")
    with pytest.raises(PromptError, match="mandatory guardrail"):
        load_prompt("bad", prompt_dir=str(tmp_path))


def test_guardrail_validation_names_both_requirements() -> None:
    with pytest.raises(PromptError):
        validate_prompt_text("x", "Never use the words scam or fraud.")  # missing the other
    with pytest.raises(PromptError):
        validate_prompt_text("x", "Say no evidence found when unsure.")  # missing the other
    validate_prompt_text("x", GUARDRAILS)


def test_render_requires_every_placeholder_to_be_filled(tmp_path) -> None:
    load_prompt.cache_clear()
    write_prompt(tmp_path, "t", f"Entity {{{{entity}}}} in {{{{fy}}}}. {GUARDRAILS}")
    prompt = load_prompt("t", prompt_dir=str(tmp_path))

    assert "min-x" in prompt.render(entity="min-x", fy="FY2026")
    with pytest.raises(PromptError, match="unfilled placeholders"):
        prompt.render(entity="min-x")
    with pytest.raises(PromptError, match="no placeholder"):
        prompt.render(entity="min-x", fy="FY2026", nonexistent="z")


@pytest.mark.parametrize("name", all_prompt_names())
def test_every_shipped_prompt_loads_and_carries_its_guardrails(name: str) -> None:
    load_prompt.cache_clear()
    prompt = load_prompt(name)
    assert prompt.text.strip()
    assert "—" not in prompt.text, "prompts must not model em-dash usage in product copy"


def test_shipped_prompt_set_is_not_empty() -> None:
    names = all_prompt_names()
    assert names, f"no prompt files found in {PROMPT_DIR}"
    assert "a4_self_check" in names


@pytest.mark.parametrize(
    "text",
    [
        "This looks like a scam to us.",
        "Evidence of fraud in the release pattern.",
        "Funds appear to have been siphoned off.",
        "A corrupt allocation process.",
        "The money was misappropriated.",
        "Officials embezzled the grant.",
        "The scheme was looted.",
    ],
)
def test_banned_vocabulary_is_detected(text: str) -> None:
    assert find_banned_vocabulary(text)
    with pytest.raises(PromptError, match="docs/08"):
        assert_publishable(text, context="explanation")


@pytest.mark.parametrize(
    "text",
    [
        "Utilization stood at 38 percent with 75 percent of the year elapsed.",
        "No matching tenders were found in the central procurement portal.",
        "The revised estimate is 26 percent below the budget estimate.",
    ],
)
def test_approved_framing_passes(text: str) -> None:
    assert find_banned_vocabulary(text) == []
    assert assert_publishable(text) == text


def test_banned_vocabulary_covers_the_docs_list() -> None:
    for required in ("scam", "fraud", "siphon", "corrupt"):
        assert any(term.startswith(required) for term in BANNED_VOCABULARY)
