"""Tests for the local Ollama transport.

No server is touched: ``urlopen`` is monkeypatched to return canned bodies, so
the translation in both directions is exercised without a network or a model.
The end-to-end test drives a real :class:`AgentClient.structured` call through
the transport to prove the Anthropic-shaped dict it returns satisfies every
response-flattening helper the wrapper relies on.
"""

from __future__ import annotations

import io
import json
import urllib.error
from typing import Any

import pytest
from pydantic import BaseModel, Field

from agents.lib.client import AgentClient, MemoryCallLogger
from agents.lib.config import AgentSettings
from agents.lib.ollama import (
    OllamaError,
    OllamaTransport,
    _flatten_content,
    build_ollama_payload,
)

# ---------------------------------------------------------------------------
# Payload translation
# ---------------------------------------------------------------------------


def test_flatten_content_passes_a_string_through() -> None:
    assert _flatten_content("hello") == "hello"


def test_flatten_content_joins_text_blocks_and_drops_others() -> None:
    content = [
        {"type": "text", "text": "first"},
        {"type": "tool_use", "id": "x"},
        {"type": "text", "text": "second"},
    ]
    assert _flatten_content(content) == "first\n\nsecond"


def test_build_payload_puts_system_first_and_flattens_user_content() -> None:
    request = {
        "model": "llama3.1:8b",
        "system": "You are a careful clerk.",
        "messages": [{"role": "user", "content": [{"type": "text", "text": "extract this"}]}],
        "max_tokens": 1024,
    }
    payload = build_ollama_payload(request, num_ctx=4096)

    assert payload["model"] == "llama3.1:8b"
    assert payload["stream"] is False
    assert payload["messages"][0] == {"role": "system", "content": "You are a careful clerk."}
    assert payload["messages"][1] == {"role": "user", "content": "extract this"}
    assert payload["options"]["num_predict"] == 1024
    assert payload["options"]["num_ctx"] == 4096
    # Deterministic by construction: these agents verify figures, not brainstorm.
    assert payload["options"]["temperature"] == 0


def test_build_payload_forwards_a_json_schema_as_the_format_field() -> None:
    schema = {"type": "object", "properties": {"n": {"type": "integer"}}}
    request = {
        "model": "llama3.1:8b",
        "system": "s",
        "messages": [{"role": "user", "content": "u"}],
        "output_config": {"format": {"type": "json_schema", "schema": schema}},
    }
    payload = build_ollama_payload(request, num_ctx=8192)
    assert payload["format"] == schema


def test_build_payload_omits_format_without_a_schema() -> None:
    request = {
        "model": "llama3.1:8b",
        "system": "s",
        "messages": [{"role": "user", "content": "u"}],
        "output_config": {"effort": "high"},
    }
    payload = build_ollama_payload(request, num_ctx=8192)
    assert "format" not in payload


# ---------------------------------------------------------------------------
# create() over a faked server
# ---------------------------------------------------------------------------


class _FakeHTTPResponse(io.BytesIO):
    """A urlopen return value: a context manager whose read() yields bytes."""

    def __enter__(self) -> _FakeHTTPResponse:
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()


def _ollama_body(text: str) -> dict[str, Any]:
    return {
        "model": "llama3.1:8b",
        "message": {"role": "assistant", "content": text},
        "done_reason": "stop",
        "prompt_eval_count": 42,
        "eval_count": 17,
    }


def test_create_rewraps_response_in_anthropic_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    def fake_urlopen(req: Any, timeout: float | None = None) -> _FakeHTTPResponse:
        captured["body"] = json.loads(req.data.decode("utf-8"))
        return _FakeHTTPResponse(json.dumps(_ollama_body('{"ok": true}')).encode("utf-8"))

    monkeypatch.setattr("agents.lib.ollama.urllib.request.urlopen", fake_urlopen)
    transport = OllamaTransport(base_url="http://localhost:11434")

    result = transport.create(
        model="llama3.1:8b",
        system="s",
        messages=[{"role": "user", "content": "u"}],
        max_tokens=256,
    )

    assert result["content"] == [{"type": "text", "text": '{"ok": true}'}]
    assert result["usage"] == {"input_tokens": 42, "output_tokens": 17}
    assert result["model"] == "llama3.1:8b"
    assert result["stop_reason"] == "stop"
    # The request actually posted was the translated Ollama body.
    assert captured["body"]["messages"][0]["role"] == "system"


def test_create_raises_a_clear_error_when_the_server_is_down(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_urlopen(req: Any, timeout: float | None = None) -> Any:
        raise urllib.error.URLError("Connection refused")

    monkeypatch.setattr("agents.lib.ollama.urllib.request.urlopen", fake_urlopen)
    transport = OllamaTransport()

    with pytest.raises(OllamaError, match="Could not reach the Ollama server"):
        transport.create(model="llama3.1:8b", system="s", messages=[{"role": "user", "content": "u"}])


def test_create_rejects_web_search_tools() -> None:
    transport = OllamaTransport()
    with pytest.raises(OllamaError, match="no server-side web search"):
        transport.create(
            model="llama3.1:8b",
            system="s",
            messages=[{"role": "user", "content": "u"}],
            tools=[{"type": "web_search_20260209", "name": "web_search"}],
        )


# ---------------------------------------------------------------------------
# End to end through AgentClient.structured
# ---------------------------------------------------------------------------


class _Extraction(BaseModel):
    ministry: str
    amount_inr_cr: float = Field(ge=0)


def test_structured_call_validates_through_the_ollama_transport(
    base_settings: Any, tmp_path: Any, prompt: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = AgentSettings(
        anthropic_api_key="",
        model_fast="llama3.1:8b",
        model_standard="llama3.1:8b",
        model_narrative="llama3.1:8b",
        enable_web_search=False,
        web_search_allowlist=(),
        max_output_tokens=1024,
        state_dir=tmp_path / "state",
        base=base_settings,
        provider="ollama",
    )

    def fake_urlopen(req: Any, timeout: float | None = None) -> _FakeHTTPResponse:
        payload = {"ministry": "Ministry of Jal Shakti", "amount_inr_cr": 70000}
        return _FakeHTTPResponse(json.dumps(_ollama_body(json.dumps(payload))).encode("utf-8"))

    monkeypatch.setattr("agents.lib.ollama.urllib.request.urlopen", fake_urlopen)
    logger = MemoryCallLogger()
    client = AgentClient(settings=settings, call_logger=logger)

    result = client.structured(
        agent_id="A1",
        prompt=prompt,
        system="Extract the figure.",
        user_content="Ministry of Jal Shakti was allocated 70000 crore.",
        schema=_Extraction,
        model=settings.model_standard,
    )

    assert result.ministry == "Ministry of Jal Shakti"
    assert result.amount_inr_cr == 70000
    # The telemetry row records the local model, and validation passed.
    assert any(call.model == "llama3.1:8b" and call.validation_passed for call in logger.calls)


def test_ollama_is_the_default_provider() -> None:
    from agents.lib.config import _MODEL_DEFAULTS, DEFAULT_PROVIDER

    # The default must be local: a fresh deployment should generate with no API
    # key and nothing bought.
    assert DEFAULT_PROVIDER == "ollama"
    assert _MODEL_DEFAULTS["ollama"]["narrative"].startswith("llama")


def test_agent_settings_defaults_to_the_local_provider(base_settings: Any, tmp_path: Any) -> None:
    settings = AgentSettings(
        anthropic_api_key="",
        model_fast="llama3.1:8b",
        model_standard="llama3.1:8b",
        model_narrative="llama3.1:8b",
        enable_web_search=False,
        web_search_allowlist=(),
        max_output_tokens=1024,
        state_dir=tmp_path / "state",
        base=base_settings,
    )
    assert settings.provider == "ollama"
    assert settings.ollama_base_url == "http://localhost:11434"
