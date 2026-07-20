"""A4 self check: the test that stops a fabricated figure reaching a reader.

This is the highest-value test in the layer. Everything else on the site traces
to a source record by construction; a narrative is the one surface where a model
writes prose that *looks* like it traces to one. The self check is what makes
that surface safe, so it is tested at the level of "a plausible wrong number
must not survive", not at the level of "the function returns a bool".
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from agents.a4_verification.agent import VerificationAgent
from agents.a4_verification.facts import (
    EvidenceLine,
    FactBundle,
    FactLine,
    TenderLine,
    compute_derived,
)
from agents.a4_verification.self_check import deterministic_check, run_self_check
from agents.tests.conftest import text_response


def bundle(*, with_derived: bool = True, tenders: tuple[TenderLine, ...] = ()) -> FactBundle:
    base = FactBundle(
        entity_type="ministry",
        entity_id="min-fixture-water",
        entity_label="Ministry of Fixture Water",
        fy="FY2026",
        fiscal_facts=(
            FactLine(
                stage="BE",
                head="total",
                amount_inr_cr=Decimal("21000.00"),
                source_record_id=401,
                document_date=date(2025, 2, 1),
            ),
            FactLine(
                stage="EXPENDITURE",
                head="total",
                amount_inr_cr=Decimal("9100.00"),
                source_record_id=403,
                period_end=date(2025, 11, 30),
                is_cumulative=True,
            ),
        ),
        tenders=tenders,
        evidence=(
            EvidenceLine(
                evidence_id=71,
                kind="pib",
                title="Fixture Water review meeting held",
                published_date=date(2025, 10, 2),
            ),
        ),
    )
    if not with_derived:
        return base
    return FactBundle(
        entity_type=base.entity_type,
        entity_id=base.entity_id,
        entity_label=base.entity_label,
        fy=base.fy,
        fiscal_facts=base.fiscal_facts,
        tenders=base.tenders,
        evidence=base.evidence,
        derived=compute_derived(base),
    )


FAITHFUL = (
    "## Reported\n\n"
    "The Budget Estimate for FY2026 was 21,000.00 INR crore [source:401]. Cumulative "
    "expenditure to 30 November 2025 was 9,100.00 INR crore [source:403].\n\n"
    "## Observable activity\n\n"
    "A review meeting was reported in October 2025 [evidence:71].\n\n"
    "## What is not in the record\n\n"
    "No evidence found in the indexed sources describes how the funds were applied."
)

HALLUCINATED = FAITHFUL.replace("9,100.00", "9,842.00")


# ---------------------------------------------------------------------------
# The deterministic pass
# ---------------------------------------------------------------------------


def test_a_faithful_narrative_passes() -> None:
    assert deterministic_check(FAITHFUL, bundle()).passed


def test_a_hallucinated_figure_is_caught() -> None:
    """The single most important assertion in this package."""
    result = deterministic_check(HALLUCINATED, bundle())
    assert not result.passed
    assert any("9,842.00" in problem for problem in result.problems)
    assert [m.raw for m in result.unsupported] == ["9,842.00"]


def test_a_nearly_right_figure_is_caught() -> None:
    """Transposed digits are the dangerous case: they look like everything else."""
    narrative = FAITHFUL.replace("21,000.00", "12,000.00")
    result = deterministic_check(narrative, bundle())
    assert not result.passed
    assert any("12,000.00" in problem for problem in result.problems)


def test_a_computed_figure_is_caught_even_when_the_arithmetic_is_right() -> None:
    """43.3 percent is correct. It is still untraceable to a source record."""
    narrative = FAITHFUL + "\n\nThat is 43.3 percent of the Budget Estimate."
    result = deterministic_check(narrative, bundle(with_derived=False))
    assert not result.passed
    assert any("43.3" in problem for problem in result.problems)


def test_the_same_figure_passes_once_it_is_supplied_as_a_fact() -> None:
    """The fix is to compute it in Python and hand it over, not to relax the check."""
    ready = bundle()
    share = ready.derived["share of authority spent, percent"]
    narrative = FAITHFUL + f"\n\nThe facts record {share} percent of the authority as spent."
    assert deterministic_check(narrative, ready).passed


def test_rounding_a_stated_figure_is_allowed() -> None:
    narrative = FAITHFUL.replace("21,000.00", "21,000")
    assert deterministic_check(narrative, bundle()).passed


def test_fiscal_year_labels_and_citations_are_not_quantities() -> None:
    narrative = (
        "## Reported\n\nFY2026 figures cite [source:401] and [evidence:71] and Q4 activity.\n\n"
        "## Observable activity\n\nNo evidence found.\n\n"
        "## What is not in the record\n\nNothing further."
    )
    assert deterministic_check(narrative, bundle()).passed


def test_dates_do_not_decompose_into_stray_numbers() -> None:
    narrative = (
        "## Reported\n\nThe figure covers the period ending 30 November 2025 and was "
        "published on 2026-01-15.\n\n## Observable activity\n\nNo evidence found.\n\n"
        "## What is not in the record\n\nNothing further."
    )
    assert deterministic_check(narrative, bundle()).passed


def test_a_tender_count_is_a_fact() -> None:
    with_tenders = bundle(
        tenders=(
            TenderLine(
                tender_id="FX/2025/0100",
                title="Fixture track renewal",
                status="published",
                value_inr_cr=Decimal("120.00"),
                published_date=date(2025, 6, 1),
            ),
        )
    )
    narrative = (
        "## Reported\n\nThe Budget Estimate was 21,000.00 INR crore [source:401].\n\n"
        "## Observable activity\n\n1 matching tender worth 120.00 INR crore was published "
        "[tender:FX/2025/0100].\n\n## What is not in the record\n\nNo evidence found beyond that."
    )
    assert deterministic_check(narrative, with_tenders).passed


def test_accusatory_vocabulary_fails_the_check() -> None:
    narrative = FAITHFUL + "\n\nThe pattern suggests funds were siphoned."
    result = deterministic_check(narrative, bundle())
    assert not result.passed
    assert any("docs/08" in problem for problem in result.problems)


def test_em_dashes_fail_the_check() -> None:
    narrative = FAITHFUL.replace("[source:401].", "[source:401] — the largest line.")
    result = deterministic_check(narrative, bundle())
    assert not result.passed
    assert any("em-dash" in problem for problem in result.problems)


# ---------------------------------------------------------------------------
# Both passes together
# ---------------------------------------------------------------------------


def test_both_passes_must_agree(client, transport) -> None:
    transport.queue(text_response({"passed": True, "problems": []}))
    assert run_self_check(client, FAITHFUL, bundle()).passed


def test_the_model_cannot_wave_through_a_bad_number(client, transport) -> None:
    """Belt and braces: a checking model that says fine is overruled by arithmetic."""
    transport.queue(text_response({"passed": True, "problems": []}))
    result = run_self_check(client, HALLUCINATED, bundle())
    assert not result.passed
    assert result.details == {"deterministic": False, "model": True}


def test_the_model_can_catch_what_a_regex_cannot(client, transport) -> None:
    """A RELEASE described as expenditure: right number, wrong stage."""
    narrative = FAITHFUL.replace("Cumulative expenditure to", "The ministry spent, up to")
    transport.queue(
        text_response(
            {
                "passed": False,
                "problems": ["A figure the facts label EXPENDITURE is described as a release."],
            }
        )
    )
    result = run_self_check(client, narrative, bundle())
    assert not result.passed
    assert result.details == {"deterministic": True, "model": False}


def test_a_failed_check_call_fails_the_narrative(client, transport) -> None:
    """Unverified is not published. The fallback rendering is always available."""
    transport.queue(RuntimeError("checker unavailable"))
    result = run_self_check(client, FAITHFUL, bundle())
    assert not result.passed
    assert result.model_pass_errored
    assert any("could not be completed" in problem for problem in result.problems)


# ---------------------------------------------------------------------------
# The agent's regenerate-once-then-fall-back loop
# ---------------------------------------------------------------------------


def draft(narrative: str) -> dict:
    return {
        "narrative_md": narrative,
        "citations": [{"kind": "source", "ref": "401", "label": "Budget Estimate"}],
        "confidence": "high",
    }


def build_agent(client, conn, monkeypatch) -> VerificationAgent:
    agent = VerificationAgent(client, conn)
    monkeypatch.setattr(agent, "build_bundle", lambda *a, **k: bundle())
    return agent


def test_a_clean_first_draft_is_published(client, conn, raw_conn, transport, monkeypatch):
    agent = build_agent(client, conn, monkeypatch)
    transport.queue(
        text_response(draft(FAITHFUL)),
        text_response({"passed": True, "problems": []}),
    )

    outcome = agent.run("ministry", "min-fixture-water", "FY2026")

    assert outcome.self_check_passed is True
    assert outcome.is_fallback is False
    assert outcome.attempts == 1
    params = raw_conn.params_for("INSERT INTO verification_report")[0]
    assert params["self_check_passed"] is True
    assert params["is_fallback"] is False
    assert params["prompt_version"] == agent.prompt.version


def test_a_failed_draft_is_regenerated_once(client, conn, raw_conn, transport, monkeypatch):
    agent = build_agent(client, conn, monkeypatch)
    transport.queue(
        text_response(draft(HALLUCINATED)),
        text_response({"passed": False, "problems": ["invented figure"]}),
        text_response(draft(FAITHFUL)),
        text_response({"passed": True, "problems": []}),
    )

    outcome = agent.run("ministry", "min-fixture-water", "FY2026")

    assert outcome.attempts == 2
    assert outcome.self_check_passed is True
    assert outcome.is_fallback is False
    assert "9,842.00" not in outcome.narrative_md
    # The rewrite instruction carries the specific failure, not a generic nudge.
    rewrite = transport.requests[2]["messages"][0]["content"][0]["text"]
    assert "9,842.00" in rewrite
    assert "failed its self check" in rewrite


def test_two_failures_fall_back_to_the_template(client, conn, raw_conn, transport, monkeypatch):
    """docs/05 A4 step 5. The record is shown instead of an unverifiable analysis."""
    agent = build_agent(client, conn, monkeypatch)
    transport.queue(
        text_response(draft(HALLUCINATED)),
        text_response({"passed": False, "problems": ["invented figure"]}),
        text_response(draft(HALLUCINATED.replace("9,842.00", "9,999.00"))),
        text_response({"passed": False, "problems": ["invented figure again"]}),
    )

    outcome = agent.run("ministry", "min-fixture-water", "FY2026")

    assert outcome.is_fallback is True
    assert outcome.self_check_passed is False
    assert "9,842.00" not in outcome.narrative_md
    assert "9,999.00" not in outcome.narrative_md
    assert "21,000" in outcome.narrative_md, "the fallback still shows the real figures"

    params = raw_conn.params_for("INSERT INTO verification_report")[0]
    assert params["is_fallback"] is True
    assert params["self_check_passed"] is False


def test_the_fallback_rendering_passes_its_own_check() -> None:
    """A template that could not survive the self check would be no safer."""
    ready = bundle()
    from agents.a4_verification.fallback import render_fallback

    assert deterministic_check(render_fallback(ready), ready).passed


def test_a_compose_failure_falls_back_rather_than_raising(client, conn, transport, monkeypatch):
    agent = build_agent(client, conn, monkeypatch)
    transport.queue(RuntimeError("writer unavailable"))

    outcome = agent.run("ministry", "min-fixture-water", "FY2026", write=False)

    assert outcome.is_fallback is True
    assert outcome.self_check_passed is False
    assert outcome.narrative_md.startswith("## Reported")


def test_a_banned_word_short_circuits_before_the_self_check(client, conn, transport, monkeypatch):
    agent = build_agent(client, conn, monkeypatch)
    accusatory = FAITHFUL + "\n\nThis looks like fraud."
    transport.queue(
        text_response(draft(accusatory)),
        text_response(draft(accusatory)),
    )

    outcome = agent.run("ministry", "min-fixture-water", "FY2026", write=False)

    assert outcome.is_fallback is True
    assert "fraud" not in outcome.narrative_md


# ---------------------------------------------------------------------------
# Derived facts
# ---------------------------------------------------------------------------


def test_derived_values_are_decimals_not_floats() -> None:
    derived = bundle().derived
    assert derived
    assert all(isinstance(value, Decimal) for value in derived.values())


def test_derived_values_are_absent_when_an_input_is_missing() -> None:
    """A missing input yields a missing figure, never a zero."""
    sparse = FactBundle(
        entity_type="scheme",
        entity_id="sch-fixture",
        entity_label="Fixture Scheme",
        fy="FY2026",
        fiscal_facts=(
            FactLine(stage="BE", head="total", amount_inr_cr=Decimal("100"), source_record_id=1),
        ),
    )
    derived = compute_derived(sparse)
    assert "unspent balance in INR crore" not in derived
    assert "share of authority spent, percent" not in derived


@pytest.mark.parametrize("attribute", ["fiscal_facts", "tenders", "evidence"])
def test_an_empty_bundle_still_renders_an_honest_prompt(attribute: str) -> None:
    empty = FactBundle(
        entity_type="scheme",
        entity_id="sch-empty",
        entity_label="Fixture Dormant Scheme",
        fy="FY2026",
    )
    rendered = {
        "fiscal_facts": empty.render_fiscal_facts(),
        "tenders": empty.render_tenders(),
        "evidence": empty.render_evidence(),
    }[attribute]
    assert "no " in rendered.lower()
