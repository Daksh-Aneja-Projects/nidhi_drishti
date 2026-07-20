"""A1: transcription in, crore out, and everything doubtful in front of a human."""

from __future__ import annotations

from decimal import Decimal

import pytest
from pydantic import ValidationError

from agents.a1_extraction_assist import (
    AUTO_ACCEPT_CONFIDENCE,
    ExtractedRow,
    ExtractionAssistAgent,
    PageInput,
    resolve_amount,
)
from agents.tests.conftest import text_response


def row(**overrides) -> ExtractedRow:
    base = {
        "entity_type": "ministry",
        "entity_label_as_printed": "Ministry of Fixture Water",
        "stage": "BE",
        "head": "total",
        "amount_as_printed": "21,000.00",
        "unit_as_printed": "crore",
        "confidence": 0.95,
    }
    return ExtractedRow(**{**base, **overrides})


@pytest.mark.parametrize(
    ("printed", "unit", "expected"),
    [
        ("21,000.00", "crore", Decimal("21000.00")),
        ("45,600", "lakh", Decimal("456.00")),
        ("50.65", "lakh crore", Decimal("5065000")),
        ("4,50,00,000", "rupee", Decimal("4.5")),
        ("(1,204.50)", "crore", Decimal("-1204.50")),
    ],
)
def test_units_are_converted_by_the_deterministic_parser(printed, unit, expected) -> None:
    resolved = resolve_amount(row(amount_as_printed=printed, unit_as_printed=unit))
    assert resolved.amount_inr_cr == expected
    assert resolved.is_usable


def test_an_unstated_unit_never_becomes_a_number() -> None:
    """Crore and lakh differ by a hundredfold. A guess here is a hundredfold error."""
    resolved = resolve_amount(row(amount_as_printed="12,340", unit_as_printed="unstated"))
    assert resolved.amount_inr_cr is None
    assert resolved.needs_review
    assert "no unit" in (resolved.conversion_error or "")


def test_low_confidence_rows_need_review_even_when_they_convert() -> None:
    resolved = resolve_amount(row(confidence=AUTO_ACCEPT_CONFIDENCE - 0.01))
    assert resolved.is_usable
    assert resolved.needs_review


def test_confidence_at_the_threshold_is_accepted() -> None:
    assert not resolve_amount(row(confidence=AUTO_ACCEPT_CONFIDENCE)).needs_review


def test_period_rules_are_enforced_on_the_way_in() -> None:
    with pytest.raises(ValidationError, match="annual figure"):
        row(stage="BE", period_end="2025-11-30")
    with pytest.raises(ValidationError, match="needs a period_end"):
        row(stage="EXPENDITURE")


def test_a_usable_row_becomes_an_agent_assisted_fiscal_fact_row() -> None:
    """A1 can *build* the canonical shape. It still writes nothing itself."""
    resolved = resolve_amount(row())
    fact = resolved.to_fiscal_fact_row(fy="FY2026", entity_id="min-fixture-water")
    assert fact.extraction_method == "agent_assisted"
    assert fact.is_provisional is True
    assert fact.amount_inr_cr == Decimal("21000.00")


def test_a_failed_conversion_cannot_become_a_fiscal_fact() -> None:
    resolved = resolve_amount(row(unit_as_printed="unstated"))
    with pytest.raises(ValueError, match="failed conversion"):
        resolved.to_fiscal_fact_row(fy="FY2026", entity_id="min-fixture-water")


def test_agent_splits_usable_from_review(client, transport) -> None:
    transport.queue(
        text_response(
            {
                "rows": [
                    {
                        "entity_type": "ministry",
                        "entity_label_as_printed": "Ministry of Fixture Water",
                        "stage": "BE",
                        "head": "total",
                        "amount_as_printed": "21,000.00",
                        "unit_as_printed": "crore",
                        "confidence": 0.95,
                        "source_cell_text": "21,000.00",
                    },
                    {
                        "entity_type": "ministry",
                        "entity_label_as_printed": "Ministry of Fixture Water",
                        "stage": "RE",
                        "head": "total",
                        "amount_as_printed": "19,750",
                        "unit_as_printed": "unstated",
                        "confidence": 0.55,
                        "source_cell_text": "19,750",
                    },
                ],
                "page_is_fiscal_table": True,
                "notes": "The second column carries no unit.",
            }
        )
    )
    agent = ExtractionAssistAgent(client)
    outcome = agent.run(
        PageInput(
            source_id="union_budget",
            document_title="FIXTURE Expenditure Budget",
            page_number=41,
            fy="FY2026",
            page_text="(In Rs. crore) ...",
        )
    )

    assert len(outcome.usable) == 1
    assert len(outcome.needs_review) == 1
    assert outcome.usable[0].amount_inr_cr == Decimal("21000.00")
    assert any("no unit" in reason for reason in outcome.review_reasons)
    assert outcome.prompt_version == agent.prompt.version


def test_agent_writes_nothing_to_the_database(client, transport, call_logger) -> None:
    """A1 has no connection at all, by construction. The only trace is agent_call."""
    transport.queue(text_response({"rows": [], "page_is_fiscal_table": False, "notes": "prose"}))
    agent = ExtractionAssistAgent(client)
    outcome = agent.run(
        PageInput(
            source_id="union_budget",
            document_title="FIXTURE foreword",
            page_number=2,
            fy="FY2026",
            page_text="This volume presents ...",
        )
    )
    assert outcome.resolved == ()
    assert not hasattr(agent, "conn")
    assert call_logger.calls, "the call must still be logged"


def test_page_image_is_sent_as_a_base64_block(client, transport) -> None:
    transport.queue(text_response({"rows": [], "page_is_fiscal_table": True, "notes": ""}))
    agent = ExtractionAssistAgent(client)
    agent.run(
        PageInput(
            source_id="union_budget",
            document_title="FIXTURE",
            page_number=1,
            fy="FY2026",
            page_text="text layer",
            image_bytes=b"\x89PNG fixture bytes",
        )
    )
    blocks = transport.requests[0]["messages"][0]["content"]
    assert blocks[0]["type"] == "image"
    assert blocks[0]["source"]["media_type"] == "image/png"
    assert blocks[1]["type"] == "text"


def test_unsupported_image_type_is_refused(client) -> None:
    agent = ExtractionAssistAgent(client)
    with pytest.raises(ValueError, match="Unsupported page image type"):
        agent.run(
            PageInput(
                source_id="union_budget",
                document_title="FIXTURE",
                page_number=1,
                fy="FY2026",
                page_text="t",
                image_bytes=b"x",
                image_media_type="image/tiff",
            )
        )
