"""A1 - extraction assist (docs/05 A1).

Runs when the deterministic table parser reports low confidence on a PDF page.
Claude reads the page image and text and returns structured rows, which are then
re-validated by the same pydantic schema the pipelines use, converted to crore by
the same deterministic amount parser, and split into "usable" and "needs review".

**A1 writes nothing to the database except its own ``agent_call`` row.** Not to
``fiscal_fact``, and not to staging either. It returns an outcome object; the
caller puts the low-confidence rows in front of a human. That is why the class
here takes no connection for anything but call logging.
"""

from __future__ import annotations

import base64
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import structlog

from agents.a1_extraction_assist.schema import (
    AUTO_ACCEPT_CONFIDENCE,
    ExtractionResult,
    ResolvedRow,
    resolve_amount,
)
from agents.lib.client import AgentClient
from agents.lib.prompts import Prompt, load_prompt

log = structlog.get_logger(__name__)

AGENT_ID = "A1"
PROMPT_NAME = "a1_extraction"

#: Text captions on a budget page are dense and the tables are wide, so the page
#: image matters more here than in most vision tasks. Left at native resolution.
_SUPPORTED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}


@dataclass(frozen=True, slots=True)
class PageInput:
    """One page handed to the agent."""

    source_id: str
    document_title: str
    page_number: int
    fy: str
    page_text: str
    image_bytes: bytes | None = None
    image_media_type: str = "image/png"
    #: Whatever the deterministic parser managed before giving up. Shown to the
    #: model as a hint it is explicitly allowed to contradict.
    parser_hint: str = "The deterministic parser produced nothing usable for this page."


@dataclass(frozen=True, slots=True)
class ExtractionOutcome:
    """The result of one page, split by whether a human has to look."""

    page: PageInput
    result: ExtractionResult
    resolved: tuple[ResolvedRow, ...]
    prompt_version: str
    model: str

    @property
    def usable(self) -> tuple[ResolvedRow, ...]:
        """Rows convertible and confidently read. Still not written anywhere."""
        return tuple(r for r in self.resolved if not r.needs_review)

    @property
    def needs_review(self) -> tuple[ResolvedRow, ...]:
        return tuple(r for r in self.resolved if r.needs_review)

    @property
    def review_reasons(self) -> tuple[str, ...]:
        reasons: list[str] = []
        for item in self.needs_review:
            if item.conversion_error:
                reasons.append(item.conversion_error)
            else:
                reasons.append(
                    f"Model confidence {item.row.confidence:.2f} is below the "
                    f"{AUTO_ACCEPT_CONFIDENCE:.2f} threshold for "
                    f"{item.row.entity_label_as_printed!r} ({item.row.stage})."
                )
        return tuple(reasons)


class ExtractionAssistAgent:
    """docs/05 A1. Deterministic parser first, model second, human last."""

    def __init__(self, client: AgentClient, *, prompt: Prompt | None = None) -> None:
        self.client = client
        self.prompt = prompt or load_prompt(PROMPT_NAME)

    def _user_content(self, page: PageInput) -> list[dict[str, Any]]:
        blocks: list[dict[str, Any]] = []
        if page.image_bytes:
            if page.image_media_type not in _SUPPORTED_IMAGE_TYPES:
                raise ValueError(
                    f"Unsupported page image type {page.image_media_type!r}; "
                    f"expected one of {sorted(_SUPPORTED_IMAGE_TYPES)}."
                )
            blocks.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": page.image_media_type,
                        "data": base64.standard_b64encode(page.image_bytes).decode("ascii"),
                    },
                }
            )
        blocks.append(
            {
                "type": "text",
                "text": (
                    "Text layer extracted from the same page. It may be misordered where the "
                    "table has merged cells, and where it disagrees with the image the image "
                    "wins.\n\n<page_text>\n" + page.page_text.strip() + "\n</page_text>"
                ),
            }
        )
        return blocks

    def run(self, page: PageInput, *, model: str | None = None) -> ExtractionOutcome:
        chosen_model = model or self.client.settings.model_standard
        system = self.prompt.render(
            source_id=page.source_id,
            document_title=page.document_title,
            page_number=page.page_number,
            fy=page.fy,
            parser_hint=page.parser_hint,
        )
        result = self.client.structured(
            agent_id=AGENT_ID,
            prompt=self.prompt,
            system=system,
            user_content=self._user_content(page),
            schema=ExtractionResult,
            model=chosen_model,
            entity_type=None,
            entity_id=None,
        )
        resolved = tuple(resolve_amount(row) for row in result.rows)
        outcome = ExtractionOutcome(
            page=page,
            result=result,
            resolved=resolved,
            prompt_version=self.prompt.version,
            model=chosen_model,
        )
        log.info(
            "a1.page_extracted",
            source_id=page.source_id,
            page=page.page_number,
            rows=len(resolved),
            usable=len(outcome.usable),
            needs_review=len(outcome.needs_review),
            prompt_version=self.prompt.version,
        )
        return outcome

    def run_pages(
        self, pages: Sequence[PageInput], *, model: str | None = None
    ) -> list[ExtractionOutcome]:
        return [self.run(page, model=model) for page in pages]
