"""A3 agent: the model narrates, and never decides.

The properties under test:

* a flag is written whatever the model does, because the rule decided it exists;
* an explanation that states a figure the rule did not measure is discarded;
* an explanation that reads as an accusation is discarded;
* every flag is written pending, so nothing reaches the public without review.
"""

from __future__ import annotations

from decimal import Decimal

from agents.a3_anomaly.agent import AnomalyAgent
from agents.a3_anomaly.rules import Measures, rule_under_utilization
from agents.tests.conftest import text_response


def sample_measures() -> Measures:
    return Measures(
        entity_type="ministry",
        entity_id="min-fixture",
        entity_label="Ministry of Fixture",
        fy="FY2026",
        burn_ratio=Decimal("0.40"),
        pct_fy_elapsed=Decimal("0.75"),
        expenditure_to_date=Decimal("3000"),
        current_authority=Decimal("10000"),
    )


def build(client, conn) -> AnomalyAgent:
    return AnomalyAgent(client, conn)


def test_a_good_explanation_is_kept(client, conn, transport) -> None:
    agent = build(client, conn)
    measures = sample_measures()
    hit = rule_under_utilization(measures)
    assert hit is not None

    transport.queue(
        text_response(
            {
                "explanation": (
                    "Expenditure stood at a burn ratio of 0.40 with 75.0 percent of the "
                    "financial year elapsed. This does not show that funds were withheld: "
                    "central accounts run about two months behind."
                ),
                "cited_evidence_ids": [],
            }
        )
    )

    explanation, cited, is_fallback = agent.explain(measures, hit, [])
    assert not is_fallback
    assert "burn ratio of 0.40" in explanation
    assert cited == ()


def test_an_explanation_with_an_invented_figure_is_discarded(client, conn, transport) -> None:
    """The rule measured 0.40. A model that writes 0.62 loses its prose, not its flag."""
    agent = build(client, conn)
    measures = sample_measures()
    hit = rule_under_utilization(measures)
    assert hit is not None

    transport.queue(
        text_response(
            {
                "explanation": (
                    "Expenditure stood at a burn ratio of 0.62 with 75.0 percent of the year "
                    "elapsed. This may reflect reporting lag."
                ),
                "cited_evidence_ids": [],
            }
        )
    )

    explanation, _, is_fallback = agent.explain(measures, hit, [])
    assert is_fallback
    assert "0.62" not in explanation
    assert hit.does_not_show in explanation


def test_an_accusatory_explanation_is_discarded(client, conn, transport) -> None:
    agent = build(client, conn)
    measures = sample_measures()
    hit = rule_under_utilization(measures)
    assert hit is not None

    transport.queue(
        text_response(
            {
                "explanation": (
                    "The burn ratio of 0.40 at 75.0 percent of the year elapsed suggests funds "
                    "were siphoned away from the programme."
                ),
                "cited_evidence_ids": [],
            }
        )
    )

    explanation, _, is_fallback = agent.explain(measures, hit, [])
    assert is_fallback
    assert "siphon" not in explanation.lower()


def test_a_citation_to_evidence_we_never_offered_is_discarded(client, conn, transport) -> None:
    agent = build(client, conn)
    measures = sample_measures()
    hit = rule_under_utilization(measures)
    assert hit is not None
    evidence = [
        {"evidence_id": 7, "kind": "pib", "title": "Review meeting", "published_date": None}
    ]

    transport.queue(
        text_response(
            {
                "explanation": (
                    "The burn ratio was 0.40 at 75.0 percent of the year elapsed. This may "
                    "reflect reporting lag."
                ),
                "cited_evidence_ids": [7, 999],
            }
        )
    )

    _, cited, is_fallback = agent.explain(measures, hit, evidence)
    assert is_fallback
    assert cited == ()


def test_a_model_failure_still_produces_a_flag(client, conn, transport) -> None:
    """The rule decided the flag exists. A model outage does not overturn that."""
    agent = build(client, conn)
    measures = sample_measures()
    hit = rule_under_utilization(measures)
    assert hit is not None

    transport.queue(RuntimeError("model unavailable"))

    explanation, cited, is_fallback = agent.explain(measures, hit, [])
    assert is_fallback
    assert explanation == f"{hit.description} {hit.does_not_show}"
    assert cited == ()


def test_run_writes_pending_flags(client, conn, raw_conn, transport) -> None:
    raw_conn.route(
        "FROM mv_ministry_summary",
        [
            {
                "entity_type": "ministry",
                "entity_id": "min-fixture",
                "entity_label": "Ministry of Fixture",
                "fy": "FY2026",
                "be": Decimal("10000"),
                "re": None,
                "supplementary": None,
                "current_authority": Decimal("10000"),
                "expenditure_to_date": Decimal("3000"),
                "expenditure_as_of": "2025-12-31",
                "pct_fy_elapsed": Decimal("0.75"),
                "burn_ratio": Decimal("0.40"),
                "capital_expenditure": None,
                "released": None,
                "tender_count_trailing_90d": 4,
            }
        ],
    )
    transport.queue(
        text_response(
            {
                "explanation": (
                    "Expenditure stood at a burn ratio of 0.40 with 75.0 percent of the year "
                    "elapsed. This may reflect reporting lag rather than withheld funds."
                ),
                "cited_evidence_ids": [],
            }
        )
    )

    agent = build(client, conn)
    outcomes = agent.run("FY2026")

    assert len(outcomes) == 1
    assert outcomes[0].hit.rule_id == "under_utilization"
    params = raw_conn.params_for("INSERT INTO anomaly_flag")[0]
    assert params["status"] == "pending", "nothing reaches the public without human approval"
    assert params["severity"] == "notable"
    assert "does_not_show" in params["metric"]


def test_run_with_write_false_touches_nothing(client, conn, raw_conn, transport) -> None:
    raw_conn.route(
        "FROM mv_national_summary",
        [
            {
                "entity_type": "national",
                "entity_id": "national",
                "entity_label": "Union Government",
                "fy": "FY2026",
                "be": Decimal("1000"),
                "re": Decimal("1500"),
                "supplementary": None,
                "current_authority": Decimal("1500"),
                "expenditure_to_date": None,
                "expenditure_as_of": None,
                "pct_fy_elapsed": None,
                "burn_ratio": None,
                "capital_expenditure": None,
                "released": None,
                "tender_count_trailing_90d": None,
            }
        ],
    )
    transport.queue(
        text_response(
            {
                "explanation": (
                    "The Revised Estimate is 50.0 percent above the Budget Estimate. This does "
                    "not show that the original estimate was wrong."
                ),
                "cited_evidence_ids": [],
            }
        )
    )

    agent = build(client, conn)
    outcomes = agent.run("FY2026", write=False)

    assert [o.hit.rule_id for o in outcomes] == ["revision_swing"]
    assert outcomes[0].flag_id is None
    assert not raw_conn.statements_touching("insert into anomaly_flag")
