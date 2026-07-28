"""The fetch -> store_raw -> record_source_record step, shared by every source.

Written once because it is the step that must never vary. Getting an artifact
into object storage before anything is parsed, and a ``source_record`` row
written before anything is upserted, is what makes CLAUDE.md principle 1
mechanically true rather than aspirational.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any

import psycopg
import structlog

from pipelines.lib.fetch import FetchResult, PoliteClient, Retrieval, public_url
from pipelines.lib.runs import PipelineRun
from pipelines.lib.storage import ArtifactRef, ObjectStore, store_raw

log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class Ingested:
    """One artifact, stored and (unless dry-run) recorded."""

    fetch: FetchResult
    artifact: ArtifactRef
    #: None during a dry run, when nothing is written to the database.
    source_record_id: int | None

    @property
    def content(self) -> bytes:
        return self.fetch.content

    @property
    def text(self) -> str:
        return self.fetch.text

    @property
    def retrieval(self) -> Retrieval:
        return self.fetch.retrieval

    @property
    def unchanged(self) -> bool:
        """True when these exact bytes were already in the bucket.

        The caller may skip the parse, but only if it has already recorded facts
        from this artifact. On a fresh database the bucket can be ahead of the
        tables, so this is a hint, never a guarantee.
        """
        return self.artifact.already_present


def ingest_url(
    url: str,
    *,
    source_id: str,
    client: PoliteClient,
    run: PipelineRun,
    conn: psycopg.Connection[dict[str, Any]] | None = None,
    document_date: date | None = None,
    store: ObjectStore | None = None,
) -> Ingested:
    """Fetch one URL politely, store the bytes, and record the provenance row.

    ``client`` is typed as :class:`PoliteClient` but only its ``get`` is used, so
    the manual intake path substitutes its own reader here and every source
    module gets operator-download provenance without knowing intake exists.
    """
    result = client.get(url)
    # From here on the URL is the published one. An API key in a query string is
    # needed to make the request and must never survive into the bucket metadata
    # or the provenance row, both of which are readable by everyone.
    recorded_url = public_url(url)
    artifact = store_raw(
        source_id,
        recorded_url,
        result.content,
        result.content_type,
        store=store,
        when=result.fetched_at,
    )

    source_record_id: int | None = None
    if conn is not None and not run.dry_run:
        from pipelines.lib.db import record_source_record

        source_record_id = record_source_record(
            conn,
            artifact=artifact,
            fetched_at=result.fetched_at,
            # A source module that read the date out of the document wins; a
            # manual intake manifest fills the gap when it did not.
            document_date=document_date or result.retrieval.document_date,
            pipeline_run_id=run.run_id,
            url=recorded_url,
            retrieval=result.retrieval,
        )

    return Ingested(fetch=result, artifact=artifact, source_record_id=source_record_id)


def summarise_artifacts(items: Sequence[Ingested]) -> dict[str, Any]:
    """Metrics block describing what was fetched, for ``pipeline_run.metrics``."""
    return {
        "artifacts_fetched": len(items),
        "artifacts_new": sum(1 for item in items if not item.unchanged),
        "bytes_fetched": sum(item.artifact.byte_size for item in items),
        "artifact_keys": [item.artifact.key for item in items][:20],
        # Surfaces on the ops page: a source that has quietly become entirely
        # hand-fed is a source whose automation has broken.
        "artifacts_operator_download": sum(
            1 for item in items if item.retrieval.method == "operator_download"
        ),
    }
