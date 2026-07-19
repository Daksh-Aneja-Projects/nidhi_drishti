"""The Anthropic client wrapper every agent calls through.

Three jobs, none of which an individual agent should be re-implementing:

* **Telemetry.** Every call - successful, refused, or exploded - writes one
  ``agent_call`` row with agent id, model, prompt version, tokens, latency and
  the validation outcome (docs/09 plane B). The write happens in a ``finally``,
  so a call that raises still leaves a trace; a cost review that silently omits
  the failures is the one that misses the runaway retry loop.
* **Structured output.** JSON-schema-constrained responses re-validated against
  the caller's pydantic model, with one corrective retry. The retry feeds the
  validation error back to the model rather than resampling blindly.
* **Lazy transport.** ``anthropic`` is imported only when a real call is made,
  so the whole test suite runs with no API key, no network and no SDK installed.
"""

from __future__ import annotations

import json
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol, TypeVar

import structlog
from pydantic import BaseModel, ValidationError

from agents.lib.config import AgentSettings, get_agent_settings
from agents.lib.db import GuardedConnection, record_agent_call
from agents.lib.prompts import Prompt

log = structlog.get_logger(__name__)

T = TypeVar("T", bound=BaseModel)


class AgentCallError(RuntimeError):
    """Raised when a call cannot be turned into a usable result."""


class StructuredOutputError(AgentCallError):
    """Raised when the model's JSON never validated against the schema."""


@dataclass(frozen=True, slots=True)
class AgentCallRecord:
    """One row of ``agent_call``."""

    agent_id: str
    model: str
    prompt_version: str
    input_tokens: int | None = None
    output_tokens: int | None = None
    latency_ms: int | None = None
    validation_passed: bool | None = None
    entity_type: str | None = None
    entity_id: str | None = None
    error_text: str | None = None

    def as_params(self) -> dict[str, Any]:
        return {
            "agent_id": self.agent_id,
            "model": self.model,
            "prompt_version": self.prompt_version,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "latency_ms": self.latency_ms,
            "validation_passed": self.validation_passed,
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            # Truncated: an SDK traceback can be enormous and the column is for
            # triage, not for forensics. The full error is in the structured log.
            "error_text": self.error_text[:2000] if self.error_text else None,
        }


class CallLogger(Protocol):
    """Where ``agent_call`` rows go."""

    def record(self, call: AgentCallRecord) -> None: ...


class StructlogCallLogger:
    """Fallback logger for local runs with no database.

    Never silently drops a call: it logs at warning level precisely so that a
    process running without a database sink is visible rather than convenient.
    """

    def record(self, call: AgentCallRecord) -> None:
        log.warning("agent_call.not_persisted", **call.as_params())


@dataclass
class DatabaseCallLogger:
    """Writes to ``agent_call``. The only agent write that happens on every call."""

    conn: GuardedConnection

    def record(self, call: AgentCallRecord) -> None:
        record_agent_call(self.conn, call.as_params())


@dataclass
class MemoryCallLogger:
    """Collects records in memory. Used by the eval harness and the tests."""

    calls: list[AgentCallRecord] = field(default_factory=list)

    def record(self, call: AgentCallRecord) -> None:
        self.calls.append(call)


class MessageTransport(Protocol):
    """The one SDK surface this package depends on."""

    def create(self, **kwargs: Any) -> Any: ...


class AnthropicTransport:
    """Thin adapter over ``anthropic.Anthropic().messages``.

    Imported lazily so that neither the test suite nor a pipeline that merely
    imports an agent module needs the SDK present.
    """

    def __init__(self, api_key: str, *, timeout: float = 180.0) -> None:
        try:
            import anthropic  # noqa: PLC0415 - deliberately lazy
        except ImportError as exc:  # pragma: no cover - depends on the environment
            raise AgentCallError(
                "The 'anthropic' package is not installed. Add it to the root pyproject "
                "dependencies and run `uv sync` before running an agent against the API."
            ) from exc
        if not api_key:
            raise AgentCallError("ANTHROPIC_API_KEY is not set.")
        self._client = anthropic.Anthropic(api_key=api_key, timeout=timeout)

    def create(self, **kwargs: Any) -> Any:  # pragma: no cover - needs the network
        return self._client.messages.create(**kwargs)


@dataclass(frozen=True, slots=True)
class TextResult:
    """A completed call, flattened to the bits the agents actually use."""

    text: str
    model: str
    input_tokens: int | None
    output_tokens: int | None
    latency_ms: int
    stop_reason: str | None
    raw: Any = None
    web_sources: tuple[str, ...] = ()


def _blocks(response: Any) -> Sequence[Any]:
    content = getattr(response, "content", None)
    if content is None and isinstance(response, Mapping):
        content = response.get("content")
    return list(content or [])


def _block_attr(block: Any, name: str) -> Any:
    if isinstance(block, Mapping):
        return block.get(name)
    return getattr(block, name, None)


def extract_text(response: Any) -> str:
    """Concatenate the text blocks, ignoring thinking and tool-use blocks."""
    parts: list[str] = []
    for block in _blocks(response):
        if _block_attr(block, "type") == "text":
            parts.append(str(_block_attr(block, "text") or ""))
    return "\n".join(parts).strip()


def extract_web_sources(response: Any) -> tuple[str, ...]:
    """URLs returned by the server-side web-search tool, deduplicated in order.

    These become citations. A narrative may only cite what actually came back.
    """
    urls: list[str] = []
    for block in _blocks(response):
        if _block_attr(block, "type") != "web_search_tool_result":
            continue
        content = _block_attr(block, "content")
        if not isinstance(content, (list, tuple)):
            continue
        for item in content:
            url = _block_attr(item, "url")
            if url and url not in urls:
                urls.append(str(url))
    return tuple(urls)


def _usage(response: Any) -> tuple[int | None, int | None]:
    usage = getattr(response, "usage", None)
    if usage is None and isinstance(response, Mapping):
        usage = response.get("usage")
    if usage is None:
        return None, None
    getter = usage.get if isinstance(usage, Mapping) else lambda k: getattr(usage, k, None)  # type: ignore[assignment]
    raw_in, raw_out = getter("input_tokens"), getter("output_tokens")
    return (
        int(raw_in) if raw_in is not None else None,
        int(raw_out) if raw_out is not None else None,
    )


def json_schema_for(model: type[BaseModel]) -> dict[str, Any]:
    """A strict-outputs-compatible JSON schema for a pydantic model.

    Structured outputs require ``additionalProperties: false`` on every object,
    which pydantic does not emit, so it is added here rather than hand-written
    into each agent's schema where it would eventually be forgotten.
    """
    schema = model.model_json_schema()
    _harden(schema)
    return schema


def _harden(node: Any) -> None:
    if isinstance(node, dict):
        if node.get("type") == "object" or "properties" in node:
            node.setdefault("additionalProperties", False)
        for value in node.values():
            _harden(value)
    elif isinstance(node, list):
        for item in node:
            _harden(item)


class AgentClient:
    """The single entry point every agent uses to talk to a model."""

    def __init__(
        self,
        *,
        settings: AgentSettings | None = None,
        transport: MessageTransport | None = None,
        call_logger: CallLogger | None = None,
    ) -> None:
        self.settings = settings or get_agent_settings()
        self._transport = transport
        self.call_logger: CallLogger = call_logger or StructlogCallLogger()

    @property
    def transport(self) -> MessageTransport:
        if self._transport is None:
            self._transport = AnthropicTransport(self.settings.anthropic_api_key)
        return self._transport

    # -- core ---------------------------------------------------------------

    def complete(
        self,
        *,
        agent_id: str,
        prompt: Prompt,
        system: str,
        user_content: Any,
        model: str,
        max_tokens: int | None = None,
        tools: Sequence[Mapping[str, Any]] | None = None,
        thinking: Mapping[str, Any] | None = None,
        effort: str | None = None,
        entity_type: str | None = None,
        entity_id: str | None = None,
        extra: Mapping[str, Any] | None = None,
        validation_passed: bool | None = None,
    ) -> TextResult:
        """One model call, logged whatever happens."""
        request: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens or self.settings.max_output_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user_content}],
        }
        if tools:
            request["tools"] = list(tools)
        if thinking:
            request["thinking"] = dict(thinking)
        if effort:
            request["output_config"] = {"effort": effort}
        if extra:
            request.update(extra)

        started = time.perf_counter()
        input_tokens: int | None = None
        output_tokens: int | None = None
        error_text: str | None = None
        try:
            response = self.transport.create(**request)
            input_tokens, output_tokens = _usage(response)
            latency_ms = int((time.perf_counter() - started) * 1000)
            return TextResult(
                text=extract_text(response),
                model=str(getattr(response, "model", model) or model),
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                latency_ms=latency_ms,
                stop_reason=getattr(response, "stop_reason", None),
                raw=response,
                web_sources=extract_web_sources(response),
            )
        except Exception as exc:
            error_text = f"{type(exc).__name__}: {exc}"
            validation_passed = False
            raise
        finally:
            self.call_logger.record(
                AgentCallRecord(
                    agent_id=agent_id,
                    model=model,
                    prompt_version=prompt.version,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    latency_ms=int((time.perf_counter() - started) * 1000),
                    validation_passed=validation_passed,
                    entity_type=entity_type,
                    entity_id=entity_id,
                    error_text=error_text,
                )
            )

    def structured(
        self,
        *,
        agent_id: str,
        prompt: Prompt,
        system: str,
        user_content: Any,
        schema: type[T],
        model: str,
        max_tokens: int | None = None,
        max_attempts: int = 2,
        entity_type: str | None = None,
        entity_id: str | None = None,
        thinking: Mapping[str, Any] | None = None,
        effort: str | None = None,
    ) -> T:
        """A JSON-schema-constrained call, re-validated against ``schema``.

        The schema is enforced twice on purpose: once by the API's structured
        output, once by pydantic on the way in. The API guarantees shape, not
        meaning, and it is the pydantic validators (period rules, fiscal-year
        format, confidence ranges) that decide whether a row is usable.

        On a validation failure the error text is handed back to the model.
        Resampling with the same prompt would just roll the dice again; telling
        it which field was wrong usually fixes it on the second try.
        """
        if max_attempts < 1:
            raise ValueError("max_attempts must be at least 1.")

        content = user_content if isinstance(user_content, list) else [
            {"type": "text", "text": str(user_content)}
        ]
        last_error: str = "no attempt was made"
        for attempt in range(1, max_attempts + 1):
            result = self.complete(
                agent_id=agent_id,
                prompt=prompt,
                system=system,
                user_content=content,
                model=model,
                max_tokens=max_tokens,
                entity_type=entity_type,
                entity_id=entity_id,
                thinking=thinking,
                effort=effort,
                extra={
                    "output_config": (
                        {"format": {"type": "json_schema", "schema": json_schema_for(schema)}}
                        | ({"effort": effort} if effort else {})
                    )
                },
                # Optimistic: overwritten below if parsing or validation fails,
                # and the finally-block in complete() has already recorded the
                # row, so the follow-up record is what the review query reads.
                validation_passed=None,
            )
            try:
                parsed = schema.model_validate(json.loads(result.text))
            except (json.JSONDecodeError, ValidationError) as exc:
                last_error = str(exc)
                log.warning(
                    "agent.structured_validation_failed",
                    agent_id=agent_id,
                    attempt=attempt,
                    error=last_error[:500],
                )
                self.call_logger.record(
                    AgentCallRecord(
                        agent_id=agent_id,
                        model=model,
                        prompt_version=prompt.version,
                        latency_ms=result.latency_ms,
                        validation_passed=False,
                        entity_type=entity_type,
                        entity_id=entity_id,
                        error_text=last_error,
                    )
                )
                content = [
                    *content,
                    {
                        "type": "text",
                        "text": (
                            "The previous response did not validate against the required "
                            f"schema. The validator said:\n{last_error}\n\nReturn corrected "
                            "JSON only. Do not invent values to satisfy a required field: if "
                            "a value is genuinely absent from the source, use the schema's "
                            "null or 'not reported' representation."
                        ),
                    },
                ]
                continue
            self.call_logger.record(
                AgentCallRecord(
                    agent_id=agent_id,
                    model=model,
                    prompt_version=prompt.version,
                    input_tokens=result.input_tokens,
                    output_tokens=result.output_tokens,
                    latency_ms=result.latency_ms,
                    validation_passed=True,
                    entity_type=entity_type,
                    entity_id=entity_id,
                )
            )
            return parsed

        raise StructuredOutputError(
            f"{agent_id}: model output never validated against {schema.__name__} after "
            f"{max_attempts} attempts. Last validator error: {last_error}"
        )
