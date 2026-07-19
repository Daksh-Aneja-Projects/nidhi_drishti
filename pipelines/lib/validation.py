"""The pydantic validation boundary between parsers and the canonical store.

docs/02 data-flow rule 2: validation failures alert and abort, they never
silently drop rows. A parser that quietly discards the rows it could not
understand is the worst possible failure mode, because the resulting dashboard
looks fine and is wrong. Everything here exists to make that impossible.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import structlog
from pydantic import BaseModel, ValidationError

log = structlog.get_logger(__name__)

#: How many offending rows go into the alert body. The full list stays on the
#: exception for the parse_error queue.
ALERT_SAMPLE_SIZE = 5


class SchemaDriftError(Exception):
    """Rows did not match the schema the source is supposed to produce.

    Carries the offending rows so the caller can write them to ``parse_error``
    for human review rather than discarding the only evidence of what changed.
    """

    def __init__(
        self,
        schema_name: str,
        source_id: str,
        failures: Sequence[tuple[int, Mapping[str, Any], str]],
        total_rows: int,
    ) -> None:
        self.schema_name = schema_name
        self.source_id = source_id
        #: ``(row_index, raw_row, error_text)`` for every row that failed.
        self.failures = list(failures)
        self.total_rows = total_rows
        self.failure_count = len(failures)
        rate = (self.failure_count / total_rows * 100) if total_rows else 100.0
        super().__init__(
            f"{self.failure_count} of {total_rows} rows from {source_id} failed "
            f"{schema_name} validation ({rate:.1f} percent). Canonical write aborted."
        )

    @property
    def failure_rate(self) -> float:
        """Share of rows that failed, 0..1."""
        if self.total_rows == 0:
            return 1.0
        return self.failure_count / self.total_rows

    def sample(self, limit: int = ALERT_SAMPLE_SIZE) -> list[dict[str, Any]]:
        """The first few failures, shaped for an alert body or a JSONB column."""
        return [
            {"row_index": index, "row": dict(row), "error": error}
            for index, row, error in self.failures[:limit]
        ]

    def alert_body(self, limit: int = ALERT_SAMPLE_SIZE) -> str:
        lines = [str(self), "", "First failures:"]
        for index, row, error in self.failures[:limit]:
            lines.append(f"  row {index}: {error}")
            lines.append(f"    raw: {row}")
        return "\n".join(lines)


def validate_rows[ModelT: BaseModel](
    rows: Sequence[Mapping[str, Any]],
    schema: type[ModelT],
    *,
    source_id: str = "unknown",
    allow_empty: bool = False,
) -> list[ModelT]:
    """Validate every row, or raise :class:`SchemaDriftError` with all failures.

    All rows are attempted before raising, on purpose. Knowing that 412 of 415
    rows failed because a column moved is a completely different diagnosis from
    knowing that the first one did, and the difference decides whether the fix
    is a parser change or a source outage.
    """
    validated: list[ModelT] = []
    failures: list[tuple[int, Mapping[str, Any], str]] = []

    for index, row in enumerate(rows):
        try:
            validated.append(schema.model_validate(row))
        except ValidationError as exc:
            failures.append((index, row, _compact_error(exc)))

    if failures:
        error = SchemaDriftError(schema.__name__, source_id, failures, len(rows))
        log.error(
            "validation.drift",
            source_id=source_id,
            schema=schema.__name__,
            failed=len(failures),
            total=len(rows),
        )
        raise error

    if not rows and not allow_empty:
        raise SchemaDriftError(
            schema.__name__,
            source_id,
            [(0, {}, "the source produced no rows at all")],
            0,
        )

    log.info("validation.ok", source_id=source_id, schema=schema.__name__, rows=len(validated))
    return validated


def _compact_error(exc: ValidationError) -> str:
    """One line per pydantic error, without the framework's URL footer."""
    parts = []
    for error in exc.errors():
        location = ".".join(str(item) for item in error["loc"]) or "<row>"
        parts.append(f"{location}: {error['msg']}")
    return "; ".join(parts)
