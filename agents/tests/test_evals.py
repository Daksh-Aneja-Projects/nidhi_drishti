"""The golden-set evals run as part of the normal suite.

Running them here rather than only on demand means a change to a threshold, a
unit conversion or the number checker shows up as a failing test on the commit
that made it, with the specific fixture named.
"""

from __future__ import annotations

import pytest

from agents.evals.runner import load_fixture, run_a1, run_a2, run_a4, run_all


@pytest.mark.parametrize("suite", run_all(), ids=lambda report: report.suite)
def test_every_eval_suite_scores_full_marks(suite) -> None:
    assert suite.score == 1.0, "\n" + suite.render()


def test_the_fixture_sets_are_substantial() -> None:
    assert len(load_fixture("a1_extraction.json")["cases"]) >= 10
    assert len(load_fixture("a2_aliases.json")["cases"]) >= 25
    assert len(load_fixture("a4_narratives.json")["cases"]) >= 10


def test_fixtures_are_labelled_as_fixtures() -> None:
    """Nothing here may ever be mistaken for ingested data (CLAUDE.md principle 1)."""
    for name in ("a1_extraction.json", "a2_aliases.json", "a4_narratives.json"):
        comment = load_fixture(name)["_comment"]
        assert "FIXTURE" in comment
        assert "synthetic" in comment.lower()


def test_a4_fixture_set_covers_both_outcomes() -> None:
    cases = load_fixture("a4_narratives.json")["cases"]
    labels = {case["label"] for case in cases}
    assert labels == {"faithful", "unfaithful"}
    assert any(case.get("model_only") for case in cases), (
        "at least one case must be one only the model pass can catch, or the second "
        "pass would be redundant"
    )


def test_a2_fixture_set_exercises_every_tier() -> None:
    tiers = {case["expected"]["expected_tier"] for case in load_fixture("a2_aliases.json")["cases"]}
    assert tiers == {"exact", "trigram", "agent", "queued"}


def test_suites_report_failures_readably() -> None:
    report = run_a1()
    assert "A1 extraction" in report.render()
    assert run_a2().total > 0
    assert run_a4().total > 0
