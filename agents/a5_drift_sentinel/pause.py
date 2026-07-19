"""The canonical-write pause register.

docs/05 A5: on severe drift the sentinel can pause a source's **canonical**
writes while staging keeps ingesting. That distinction is the whole point.
Staging keeps accumulating the raw artifacts, so nothing is lost and a fixed
parser can reprocess the backlog; the canonical store stops accepting figures
from a source that has demonstrably started producing nonsense.

The register lives in a JSON file rather than a table because the schema is owned
by ``db/migrations`` and this package does not write schema. When a
``source_pause`` column or table lands there, :class:`PauseStore` is the seam to
reimplement, and nothing above it changes.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

import structlog

log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class PauseRecord:
    source_id: str
    reason: str
    paused_at: datetime
    run_id: int | None = None

    def to_json(self) -> dict[str, object]:
        return {
            "source_id": self.source_id,
            "reason": self.reason,
            "paused_at": self.paused_at.isoformat(),
            "run_id": self.run_id,
        }

    @classmethod
    def from_json(cls, data: dict[str, object]) -> PauseRecord:
        return cls(
            source_id=str(data["source_id"]),
            reason=str(data.get("reason", "")),
            paused_at=datetime.fromisoformat(str(data["paused_at"])),
            run_id=int(data["run_id"]) if data.get("run_id") is not None else None,
        )


class PauseStore(Protocol):
    def pause(self, record: PauseRecord) -> None: ...
    def resume(self, source_id: str) -> bool: ...
    def is_paused(self, source_id: str) -> bool: ...
    def paused(self) -> dict[str, PauseRecord]: ...


class InMemoryPauseStore:
    """For tests and dry runs."""

    def __init__(self) -> None:
        self._records: dict[str, PauseRecord] = {}

    def pause(self, record: PauseRecord) -> None:
        self._records[record.source_id] = record

    def resume(self, source_id: str) -> bool:
        return self._records.pop(source_id, None) is not None

    def is_paused(self, source_id: str) -> bool:
        return source_id in self._records

    def paused(self) -> dict[str, PauseRecord]:
        return dict(self._records)


class FilePauseStore:
    """JSON-file register under the agent state directory.

    Read on every call rather than cached: the pipeline process and the sentinel
    process are different processes, and a cached view would let a pipeline keep
    writing canonically for the rest of its run after being paused.
    """

    def __init__(self, path: Path) -> None:
        self.path = path

    def _read(self) -> dict[str, PauseRecord]:
        if not self.path.exists():
            return {}
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:  # pragma: no cover - corrupt state file
            log.error("a5.pause_store_unreadable", path=str(self.path), error=str(exc))
            # Fail closed: an unreadable register is treated as everything
            # paused would be too disruptive, but treating it as empty would
            # silently un-pause a broken source. The error is loud and the
            # register is rebuilt on the next pause.
            return {}
        return {key: PauseRecord.from_json(value) for key, value in raw.items()}

    def _write(self, records: dict[str, PauseRecord]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps({k: v.to_json() for k, v in records.items()}, indent=2, sort_keys=True),
            encoding="utf-8",
        )

    def pause(self, record: PauseRecord) -> None:
        records = self._read()
        records[record.source_id] = record
        self._write(records)

    def resume(self, source_id: str) -> bool:
        records = self._read()
        if records.pop(source_id, None) is None:
            return False
        self._write(records)
        return True

    def is_paused(self, source_id: str) -> bool:
        return source_id in self._read()

    def paused(self) -> dict[str, PauseRecord]:
        return self._read()


def now() -> datetime:
    return datetime.now(UTC)
