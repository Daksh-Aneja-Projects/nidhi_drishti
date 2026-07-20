"""A2: the confidence threshold that decides between a mapping and a human.

The behaviour under test is the routing rule from docs/05 A2. Below 0.9 an alias
is never written, because an alias silently redirects every rupee that flows
through that name afterwards.
"""

from __future__ import annotations

import pytest

from agents.a2_entity_resolution import (
    TRIGRAM_AUTO_ACCEPT,
    TRIGRAM_MARGIN,
    Candidate,
    EntityResolutionAgent,
    ResolutionRequest,
)
from agents.lib.config import ALIAS_AUTO_ACCEPT_CONFIDENCE
from agents.tests.conftest import text_response

MINISTRY_CANDIDATES = [
    {
        "entity_id": "min-jal-shakti-ddws",
        "name": "Department of Drinking Water and Sanitation",
        "similarity": 0.58,
        "via": "reference",
    },
    {
        "entity_id": "min-jal-shakti",
        "name": "Ministry of Jal Shakti",
        "similarity": 0.55,
        "via": "reference",
    },
]


def make_agent(client, conn, raw_conn, *, candidates=None, existing=None):
    raw_conn.route("FROM entity_alias\n WHERE alias", existing or [])
    raw_conn.route("alias_hits AS", candidates if candidates is not None else MINISTRY_CANDIDATES)
    return EntityResolutionAgent(client, conn)


#: Deliberately not an exact normalised match for either candidate, and not a
#: dominant trigram hit either. This is the ambiguous middle the model exists for.
AMBIGUOUS_NAME = "Jal Shakti, Drinking Water and Sanitation Wing"


def request(raw_name: str = AMBIGUOUS_NAME) -> ResolutionRequest:
    return ResolutionRequest(raw_name=raw_name, entity_type="ministry", source_id="cppp")


def test_high_confidence_adjudication_writes_an_alias(client, conn, raw_conn, transport) -> None:
    agent = make_agent(client, conn, raw_conn)
    transport.queue(
        text_response(
            {
                "entity_id": "min-jal-shakti-ddws",
                "confidence": 0.95,
                "reasoning": "The string names the department explicitly.",
            }
        )
    )

    result = agent.resolve(request())

    assert result.entity_id == "min-jal-shakti-ddws"
    assert result.resolved_by == "agent"
    assert result.wrote_alias
    assert raw_conn.statements_touching("insert into entity_alias")
    assert not raw_conn.statements_touching("alias_review_queue")


@pytest.mark.parametrize("confidence", [0.89, 0.5, 0.0])
def test_below_the_threshold_goes_to_the_review_queue(
    client, conn, raw_conn, transport, confidence
) -> None:
    agent = make_agent(client, conn, raw_conn)
    transport.queue(
        text_response(
            {
                "entity_id": "min-jal-shakti-ddws",
                "confidence": confidence,
                "reasoning": "Plausible but not certain.",
            }
        )
    )

    result = agent.resolve(request())

    assert result.entity_id is None
    assert result.resolved_by == "queued"
    assert not result.wrote_alias
    assert raw_conn.statements_touching("alias_review_queue")
    assert not raw_conn.statements_touching("insert into entity_alias")


def test_exactly_at_the_threshold_is_accepted(client, conn, raw_conn, transport) -> None:
    """0.9 is the documented line, and the comparison must not be off by one."""
    agent = make_agent(client, conn, raw_conn)
    transport.queue(
        text_response(
            {
                "entity_id": "min-jal-shakti-ddws",
                "confidence": ALIAS_AUTO_ACCEPT_CONFIDENCE,
                "reasoning": "Confident.",
            }
        )
    )
    result = agent.resolve(request())
    assert result.resolved_by == "agent"
    assert result.wrote_alias


def test_a_null_answer_queues_rather_than_guesses(client, conn, raw_conn, transport) -> None:
    agent = make_agent(client, conn, raw_conn)
    transport.queue(
        text_response(
            {
                "entity_id": None,
                "confidence": 0.95,
                "reasoning": "No evidence found in the candidate list supports a match.",
            }
        )
    )
    result = agent.resolve(request())
    assert result.entity_id is None
    assert result.resolved_by == "queued"


def test_an_id_that_was_not_offered_is_refused(client, conn, raw_conn, transport) -> None:
    """A confident id we never offered is a hallucination, not a discovery."""
    agent = make_agent(client, conn, raw_conn)
    transport.queue(
        text_response(
            {
                "entity_id": "min-invented-department",
                "confidence": 0.99,
                "reasoning": "Very sure.",
            }
        )
    )

    result = agent.resolve(request())

    assert result.entity_id is None
    assert result.resolved_by == "queued"
    assert raw_conn.statements_touching("alias_review_queue")
    assert not raw_conn.statements_touching("insert into entity_alias")


def test_no_candidates_means_no_model_call_at_all(client, conn, raw_conn, transport) -> None:
    agent = make_agent(client, conn, raw_conn, candidates=[])
    result = agent.resolve(request("Bharat Fixture Nigam Regional Office"))
    assert result.resolved_by == "queued"
    assert transport.requests == [], "an empty shortlist has nothing to adjudicate"


def test_an_exact_normalised_match_skips_the_model(client, conn, raw_conn, transport) -> None:
    agent = make_agent(
        client,
        conn,
        raw_conn,
        candidates=[
            {
                "entity_id": "min-jal-shakti",
                "name": "Ministry of Jal Shakti",
                "similarity": 0.62,
                "via": "reference",
            }
        ],
    )
    result = agent.resolve(request("M/o Jal Shakti"))
    assert result.resolved_by == "exact"
    assert result.confidence == 1.0
    assert transport.requests == []


def test_a_dominant_trigram_match_skips_the_model() -> None:
    candidates = [
        Candidate(entity_id="min-agri", name="Ministry of Agriculture", similarity=0.95),
        Candidate(entity_id="min-rural", name="Ministry of Rural Development", similarity=0.30),
    ]
    choice = EntityResolutionAgent.deterministic_choice(
        "Ministry of Agriculture (Krishi)", candidates
    )
    assert choice is not None
    assert choice.resolved_by == "trigram"
    assert choice.entity_id == "min-agri"


def test_a_near_tie_is_never_auto_accepted() -> None:
    """Two near-identical scores are the definition of ambiguous."""
    top = TRIGRAM_AUTO_ACCEPT + 0.02
    candidates = [
        Candidate(
            entity_id="min-edu-higher", name="Department of Higher Education", similarity=top
        ),
        Candidate(
            entity_id="min-edu-school",
            name="Department of School Education",
            similarity=top - TRIGRAM_MARGIN + 0.01,
        ),
    ]
    assert EntityResolutionAgent.deterministic_choice("Department of Educaton", candidates) is None


def test_a_score_below_the_auto_accept_floor_is_adjudicated() -> None:
    candidates = [
        Candidate(
            entity_id="min-agri",
            name="Ministry of Agriculture",
            similarity=TRIGRAM_AUTO_ACCEPT - 0.01,
        )
    ]
    assert (
        EntityResolutionAgent.deterministic_choice("Krishi Mantralaya extra words", candidates)
        is None
    )


def test_an_existing_alias_is_returned_untouched(client, conn, raw_conn, transport) -> None:
    """A human decision must not be re-litigated by a model."""
    agent = make_agent(
        client,
        conn,
        raw_conn,
        existing=[{"entity_id": "min-jal-shakti", "confidence": 1.0, "resolved_by": "human"}],
    )
    result = agent.resolve(request())
    assert result.entity_id == "min-jal-shakti"
    assert transport.requests == []
    assert not raw_conn.statements_touching("insert into entity_alias")


def test_the_review_queue_carries_the_shortlist(client, conn, raw_conn, transport) -> None:
    agent = make_agent(client, conn, raw_conn)
    transport.queue(
        text_response({"entity_id": None, "confidence": 0.3, "reasoning": "Ambiguous."})
    )
    agent.resolve(request())
    params = raw_conn.params_for("INSERT INTO alias_review_queue")[0]
    assert "min-jal-shakti-ddws" in params["suggestions"]
    assert params["entity_type"] == "ministry"
