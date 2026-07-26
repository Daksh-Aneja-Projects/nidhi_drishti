"""A local-model transport that speaks Ollama's chat API.

Every agent talks to a model through :class:`agents.lib.client.MessageTransport`,
a one-method protocol (``create(**request)``). :class:`AnthropicTransport` is one
implementation; this is the other, and it lets the whole agent layer run against
a local Llama model with no API key, no per-call cost and no data leaving the
machine, which is what a public deployment of a transparency tool wants.

Two translation jobs, and nothing else:

* **Request.** The wrapper hands over an Anthropic-shaped request: a ``system``
  string, ``messages`` whose content is a list of text blocks, ``max_tokens``,
  and, for a structured call, an ``output_config`` carrying a JSON schema. This
  flattens that into Ollama's ``/api/chat`` shape and forwards the schema as the
  ``format`` field, which constrains the model's output to valid JSON of that
  shape (llama.cpp compiles the schema to a grammar).
* **Response.** Ollama returns ``{"message": {"content": ...}, "eval_count": ...}``.
  This re-wraps it as the subset of an Anthropic ``Message`` the wrapper reads:
  a ``content`` list with one text block, and a ``usage`` mapping. Every
  response-flattening helper in ``client.py`` already accepts a ``Mapping``, so
  returning a plain dict means none of that code needs a second code path.

Deliberately dependency-free: it posts with :mod:`urllib` from the standard
library rather than pulling in an HTTP client, so importing an agent never drags
in a package a local run might not have. The ``ollama`` server itself is the only
external requirement, and the error text says so when it is unreachable.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Mapping, Sequence
from typing import Any


class OllamaError(RuntimeError):
    """Raised when the Ollama server cannot be reached or returns an error."""


def _flatten_content(content: Any) -> str:
    """Collapse an Anthropic-style content value to plain text.

    ``content`` is either a bare string (a direct ``complete`` call) or a list of
    blocks (what ``structured`` builds, including the corrective-retry block).
    Only text blocks carry anything a local model can read, so tool-use and other
    block types are dropped rather than serialised into the prompt as noise.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, Sequence):
        parts: list[str] = []
        for block in content:
            if isinstance(block, Mapping):
                if block.get("type") in (None, "text"):
                    parts.append(str(block.get("text", "")))
            else:
                text = getattr(block, "text", None)
                if text is not None:
                    parts.append(str(text))
        return "\n\n".join(p for p in parts if p)
    return str(content)


def _extract_schema(request: Mapping[str, Any]) -> dict[str, Any] | None:
    """Pull the JSON schema out of the request's ``output_config`` if present.

    ``structured()`` sets ``output_config.format`` to
    ``{"type": "json_schema", "schema": {...}}``. Ollama takes the schema object
    directly as its ``format`` field. A request with only an ``effort`` hint (no
    schema) returns ``None`` and the call runs unconstrained.
    """
    output_config = request.get("output_config")
    if not isinstance(output_config, Mapping):
        return None
    fmt = output_config.get("format")
    if not isinstance(fmt, Mapping):
        return None
    if fmt.get("type") != "json_schema":
        return None
    schema = fmt.get("schema")
    return dict(schema) if isinstance(schema, Mapping) else None


def build_ollama_payload(request: Mapping[str, Any], *, num_ctx: int) -> dict[str, Any]:
    """Translate one Anthropic-shaped request into an Ollama ``/api/chat`` body.

    Pure and side-effect free so the translation is unit-testable without a
    server. ``temperature`` is pinned to zero: every agent here extracts or
    verifies a figure against a source, and sampling variety is the opposite of
    what that wants.
    """
    messages: list[dict[str, str]] = []
    system = request.get("system")
    if system:
        messages.append({"role": "system", "content": str(system)})
    for message in request.get("messages", []):
        role = message.get("role", "user") if isinstance(message, Mapping) else "user"
        raw = message.get("content") if isinstance(message, Mapping) else message
        messages.append({"role": str(role), "content": _flatten_content(raw)})

    options: dict[str, Any] = {"temperature": 0, "num_ctx": num_ctx}
    max_tokens = request.get("max_tokens")
    if max_tokens:
        options["num_predict"] = int(max_tokens)

    payload: dict[str, Any] = {
        "model": request["model"],
        "messages": messages,
        "stream": False,
        "options": options,
    }
    schema = _extract_schema(request)
    if schema is not None:
        payload["format"] = schema
    return payload


def _to_anthropic_shape(body: Mapping[str, Any], *, fallback_model: str) -> dict[str, Any]:
    """Re-wrap an Ollama response as the subset of a Message the wrapper reads."""
    message = body.get("message")
    text = ""
    if isinstance(message, Mapping):
        text = str(message.get("content", "") or "")
    return {
        "content": [{"type": "text", "text": text}],
        "model": str(body.get("model", fallback_model) or fallback_model),
        "stop_reason": body.get("done_reason"),
        "usage": {
            # Ollama names them by what it counted; the wrapper reads
            # input_tokens/output_tokens, so the telemetry column stays uniform
            # across providers.
            "input_tokens": body.get("prompt_eval_count"),
            "output_tokens": body.get("eval_count"),
        },
    }


class OllamaTransport:
    """A :class:`MessageTransport` backed by a local Ollama server.

    One instance per process, holding only the base URL and timeout. The server
    keeps the model resident between calls, so there is no client-side handle to
    manage and nothing to close.
    """

    def __init__(
        self,
        *,
        base_url: str = "http://localhost:11434",
        num_ctx: int = 8192,
        timeout: float = 600.0,
    ) -> None:
        # A local 8B model on CPU is not fast; the timeout is generous on purpose
        # so a slow extraction is a slow success rather than a spurious failure.
        self._base_url = base_url.rstrip("/")
        self._num_ctx = num_ctx
        self._timeout = timeout

    def create(self, **request: Any) -> dict[str, Any]:
        if request.get("tools"):
            # The server-side web-search tool is an Anthropic capability with no
            # Ollama equivalent. A4's search step already treats a raising
            # transport as "no evidence found", so this degrades cleanly rather
            # than fabricating sources a local model cannot actually fetch.
            raise OllamaError(
                "The Ollama provider has no server-side web search. Keep "
                "AGENT_ENABLE_WEB_SEARCH=false, or use the anthropic provider for "
                "live verification search."
            )

        payload = build_ollama_payload(request, num_ctx=self._num_ctx)
        data = json.dumps(payload).encode("utf-8")
        http_request = urllib.request.Request(
            f"{self._base_url}/api/chat",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(http_request, timeout=self._timeout) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            raise OllamaError(
                f"Ollama returned HTTP {exc.code} for model {payload['model']!r}. "
                f"Is the model pulled (`ollama pull {payload['model']}`)? Detail: {detail}"
            ) from exc
        except urllib.error.URLError as exc:
            raise OllamaError(
                f"Could not reach the Ollama server at {self._base_url}. Is it running "
                f"(`ollama serve`)? Underlying error: {exc.reason}"
            ) from exc

        if not isinstance(body, Mapping):
            raise OllamaError(f"Ollama returned an unexpected payload: {body!r:.200}")
        return _to_anthropic_shape(body, fallback_model=str(payload["model"]))
