"""The client wrapper: telemetry on every call, and structured-output retries."""

from __future__ import annotations

import pytest
from pydantic import BaseModel, ConfigDict, Field

from agents.lib.client import (
    AgentClient,
    MemoryCallLogger,
    StructuredOutputError,
    extract_text,
    extract_web_sources,
    json_schema_for,
)
from agents.tests.conftest import FakeBlock, FakeResponse, FakeTransport, text_response


class Answer(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    entity_id: str
    confidence: float = Field(ge=0.0, le=1.0)


def test_every_call_is_logged(client: AgentClient, transport, call_logger, prompt) -> None:
    transport.queue(text_response({"entity_id": "min-x", "confidence": 0.95}))

    client.complete(
        agent_id="A2",
        prompt=prompt,
        system="system",
        user_content="hello",
        model="claude-sonnet-5",
        entity_type="ministry",
        entity_id="min-x",
    )

    record = call_logger.calls[0]
    assert record.agent_id == "A2"
    assert record.model == "claude-sonnet-5"
    assert record.prompt_version == prompt.version
    assert record.input_tokens == 1200
    assert record.output_tokens == 300
    assert record.latency_ms is not None
    assert record.entity_id == "min-x"


def test_a_failed_call_is_still_logged(client: AgentClient, transport, call_logger, prompt) -> None:
    """A cost review that omits the failures misses the runaway retry loop."""
    transport.queue(RuntimeError("upstream exploded"))

    with pytest.raises(RuntimeError):
        client.complete(
            agent_id="A4",
            prompt=prompt,
            system="s",
            user_content="u",
            model="claude-opus-4-8",
        )

    record = call_logger.calls[0]
    assert record.validation_passed is False
    assert "upstream exploded" in (record.error_text or "")
    assert record.agent_id == "A4"


def test_structured_output_validates_and_logs_success(
    client: AgentClient, transport, call_logger, prompt
) -> None:
    transport.queue(text_response({"entity_id": "min-x", "confidence": 0.91}))

    answer = client.structured(
        agent_id="A2",
        prompt=prompt,
        system="s",
        user_content="u",
        schema=Answer,
        model="claude-sonnet-5",
    )

    assert answer.entity_id == "min-x"
    assert any(c.validation_passed for c in call_logger.calls)


def test_structured_output_retries_once_with_the_validator_error(
    client: AgentClient, transport, call_logger, prompt
) -> None:
    """The retry feeds the error back rather than resampling blindly."""
    transport.queue(
        text_response({"entity_id": "min-x", "confidence": 4.2}),  # out of range
        text_response({"entity_id": "min-x", "confidence": 0.93}),
    )

    answer = client.structured(
        agent_id="A2",
        prompt=prompt,
        system="s",
        user_content="u",
        schema=Answer,
        model="claude-sonnet-5",
    )

    assert answer.confidence == 0.93
    assert len(transport.requests) == 2
    retry_text = " ".join(
        block["text"] for block in transport.requests[1]["messages"][0]["content"]
    )
    assert "did not validate" in retry_text
    assert "less_than_equal" in retry_text or "confidence" in retry_text
    assert "Do not invent values" in retry_text
    assert any(c.validation_passed is False for c in call_logger.calls)
    assert any(c.validation_passed is True for c in call_logger.calls)


def test_structured_output_gives_up_after_the_retry(client: AgentClient, transport, prompt) -> None:
    transport.queue(
        text_response("not json at all"),
        text_response({"entity_id": "min-x"}),  # missing confidence
    )

    with pytest.raises(StructuredOutputError, match="never validated"):
        client.structured(
            agent_id="A2",
            prompt=prompt,
            system="s",
            user_content="u",
            schema=Answer,
            model="claude-sonnet-5",
        )


def test_structured_request_carries_a_hardened_schema(
    client: AgentClient, transport, prompt
) -> None:
    transport.queue(text_response({"entity_id": "min-x", "confidence": 0.9}))
    client.structured(
        agent_id="A2",
        prompt=prompt,
        system="s",
        user_content="u",
        schema=Answer,
        model="claude-sonnet-5",
    )
    schema = transport.requests[0]["output_config"]["format"]["schema"]
    assert schema["additionalProperties"] is False
    assert transport.requests[0]["output_config"]["format"]["type"] == "json_schema"


def test_json_schema_hardening_is_recursive() -> None:
    class Inner(BaseModel):
        value: int

    class Outer(BaseModel):
        inner: Inner

    schema = json_schema_for(Outer)
    assert schema["additionalProperties"] is False
    assert schema["$defs"]["Inner"]["additionalProperties"] is False


def test_text_extraction_ignores_non_text_blocks() -> None:
    response = FakeResponse(
        content=[
            FakeBlock(type="thinking", text="internal"),
            FakeBlock(type="text", text="visible"),
        ]
    )
    assert extract_text(response) == "visible"


def test_web_sources_are_pulled_from_search_results() -> None:
    response = FakeResponse(
        content=[
            FakeBlock(
                type="web_search_tool_result",
                content=[
                    FakeBlock(type="web_search_result", text="a"),
                ],
            ),
            FakeBlock(type="text", text="summary"),
        ]
    )
    # A result block with no url contributes nothing rather than a blank citation.
    assert extract_web_sources(response) == ()


def test_client_never_touches_the_network_without_a_transport(agent_settings) -> None:
    """No API key means the transport is never constructed until a call is made."""
    logger = MemoryCallLogger()
    client = AgentClient(settings=agent_settings, call_logger=logger)
    assert client._transport is None


def test_transport_runs_out_loudly(client: AgentClient, prompt) -> None:
    """A test that under-queues responses should fail clearly, not hang."""
    empty = FakeTransport()
    client._transport = empty
    with pytest.raises(AssertionError, match="ran out of queued responses"):
        client.complete(
            agent_id="A1",
            prompt=prompt,
            system="s",
            user_content="u",
            model="claude-sonnet-5",
        )
