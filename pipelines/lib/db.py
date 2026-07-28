"""Database access for the ingestion layer.

Thin, explicit psycopg 3 helpers over the schema in db/migrations. No ORM: the
schema is owned by SQL migrations, and a second definition of these tables in
Python would be one more place for the two to disagree.

Three rules the functions here enforce rather than assume:

* nothing writes a fiscal fact without a ``source_record_id`` (the column is NOT
  NULL, and :func:`record_source_record` is the only way to obtain one);
* every write is idempotent against the ``fiscal_fact_natural_key`` unique
  index, so re-running a pipeline over the same document is a no-op;
* a row a parser could not interpret goes to ``parse_error``, never to
  ``fiscal_fact`` with a guessed value.
"""

from __future__ import annotations

import json
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import psycopg
import structlog
from psycopg.rows import dict_row

from pipelines.lib.config import Settings, get_settings, require_known_source
from pipelines.lib.drift import RunMetrics
from pipelines.lib.fetch import AUTOMATED, Retrieval
from pipelines.lib.models import FiscalFactRow, TenderRow
from pipelines.lib.storage import ArtifactRef

log = structlog.get_logger(__name__)

#: NUMERIC(20,2). Quantising here rather than at the database boundary means the
#: value we log is the value that was stored.
_CRORE_QUANTUM = Decimal("0.01")


def quantize_crore(amount: Decimal) -> Decimal:
    """Round to the two decimal places the column actually holds."""
    return amount.quantize(_CRORE_QUANTUM, rounding=ROUND_HALF_UP)


@contextmanager
def connect(settings: Settings | None = None) -> Iterator[psycopg.Connection[dict[str, Any]]]:
    """Open a connection with dict rows and an explicit transaction.

    Committed on clean exit, rolled back on any exception. A pipeline that
    raises halfway through must leave nothing behind: a half-ingested month is
    harder to detect than a missing one.
    """
    resolved = settings or get_settings()
    with psycopg.connect(resolved.database_url, row_factory=dict_row) as conn:
        try:
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise


# ---------------------------------------------------------------------------
# pipeline_run
# ---------------------------------------------------------------------------


def start_pipeline_run(
    conn: psycopg.Connection[dict[str, Any]],
    source_id: str,
    *,
    started_at: datetime | None = None,
) -> int:
    require_known_source(source_id)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO pipeline_run (source_id, started_at, status)
            VALUES (%s, COALESCE(%s, now()), 'running')
            RETURNING run_id
            """,
            (source_id, started_at),
        )
        row = cur.fetchone()
    assert row is not None
    return int(row["run_id"])


def finish_pipeline_run(
    conn: psycopg.Connection[dict[str, Any]],
    run_id: int,
    *,
    status: str,
    metrics: Mapping[str, Any] | None = None,
    error_text: str | None = None,
) -> None:
    if status not in {"ok", "drift_alert", "failed"}:
        raise ValueError(f"Invalid terminal run status {status!r}.")
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE pipeline_run
               SET finished_at = now(),
                   status      = %s,
                   metrics     = %s::jsonb,
                   error_text  = %s
             WHERE run_id = %s
            """,
            (status, json.dumps(dict(metrics or {}), default=str), error_text, run_id),
        )


def recent_run_metrics(
    conn: psycopg.Connection[dict[str, Any]],
    source_id: str,
    *,
    limit: int = 8,
    variant: str | None = None,
) -> list[RunMetrics]:
    """Metrics of recent successful runs, most recent first.

    Only ``ok`` runs are returned. A drift-alerted run must never become the
    baseline that makes the next equally broken run look normal.

    ``variant`` narrows the history to one dataset within a source. data.gov.in
    is a single registry entry serving many unrelated tables, and a national
    four-row summary compared against a 792-row scheme statement produces a
    row-count swing of several thousand percent and a wholly changed column set.
    Both findings are correct about the numbers and useless as signals, and a
    sentinel that cries wolf on every legitimate run is one that gets ignored on
    the run that matters.
    """
    sql = """
        SELECT metrics
          FROM pipeline_run
         WHERE source_id = %s AND status = 'ok'
    """
    params: list[Any] = [source_id]
    if variant is not None:
        sql += " AND metrics -> 'extra' ->> 'dataset' = %s"
        params.append(variant)
    sql += " ORDER BY started_at DESC LIMIT %s"
    params.append(limit)

    with conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    return [RunMetrics.from_jsonable(row["metrics"] or {}) for row in rows]


# ---------------------------------------------------------------------------
# provenance
# ---------------------------------------------------------------------------


def record_source_record(
    conn: psycopg.Connection[dict[str, Any]],
    *,
    artifact: ArtifactRef,
    fetched_at: datetime,
    document_date: date | None = None,
    pipeline_run_id: int | None = None,
    url: str | None = None,
    retrieval: Retrieval = AUTOMATED,
) -> int:
    """Record one fetched artifact and return its ``source_record_id``.

    The unique key is ``(source_id, artifact_sha256)``: identical bytes fetched
    twice are the same record, so this is idempotent and the second fetch does
    not create a second provenance chain for the same document.

    ``retrieval`` says how the bytes were obtained. It is written rather than
    assumed because the provenance popover states it to the reader, and a
    hand-downloaded document described as an automated fetch is a small lie in
    the one part of the product that cannot afford any.
    """
    require_known_source(artifact.source_id)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO source_record
              (source_id, url, artifact_key, artifact_sha256, document_date,
               fetched_at, content_type, byte_size, pipeline_run_id,
               retrieval_method, retrieved_by, retrieval_note)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (source_id, artifact_sha256) DO UPDATE
              SET document_date   = COALESCE(EXCLUDED.document_date, source_record.document_date),
                  pipeline_run_id = COALESCE(EXCLUDED.pipeline_run_id,
                                             source_record.pipeline_run_id),
                  retrieval_method = EXCLUDED.retrieval_method,
                  retrieved_by     = EXCLUDED.retrieved_by,
                  retrieval_note   = COALESCE(EXCLUDED.retrieval_note,
                                              source_record.retrieval_note)
            RETURNING source_record_id
            """,
            (
                artifact.source_id,
                url or artifact.url,
                artifact.key,
                artifact.sha256,
                document_date,
                fetched_at,
                artifact.content_type,
                artifact.byte_size,
                pipeline_run_id,
                retrieval.method,
                retrieval.by,
                retrieval.note,
            ),
        )
        row = cur.fetchone()
    assert row is not None
    source_record_id = int(row["source_record_id"])
    log.info(
        "source_record.recorded",
        source_id=artifact.source_id,
        source_record_id=source_record_id,
        sha256=artifact.sha256[:12],
    )
    return source_record_id


# ---------------------------------------------------------------------------
# entity resolution
# ---------------------------------------------------------------------------

#: docs/04 section 2: a mapping below this confidence is a machine guess waiting
#: for a human, and it never resolves a figure.
TRUSTED_ALIAS_CONFIDENCE = Decimal("0.9")


def load_alias_map(
    conn: psycopg.Connection[dict[str, Any]] | None,
    entity_type: str,
    *,
    min_confidence: Decimal = TRUSTED_ALIAS_CONFIDENCE,
) -> dict[str, str]:
    """Normalised name -> stable entity id, for the exact matcher.

    Keyed by :func:`normalise_org_name` because that is the form the source
    modules present: the table stores the alias as it was written in some
    document, and "M/o Jal Shakti" has to find the same bucket as "Ministry of
    Jal Shakti".

    Returns an empty map for ``conn is None`` so a dry run behaves exactly as it
    did before, reporting every row as unresolved rather than inventing a
    mapping it cannot check.
    """
    if conn is None:
        return {}

    from pipelines.parsers.text_norm import normalise_org_name

    mapping: dict[str, str] = {}
    with conn.cursor() as cur:
        # Ordered so that a collision resolves the same way on every run. Two
        # aliases that normalise identically but point at different entities is
        # a data problem in the seed, and a run that picked a different winner
        # each time would make it maddening to find.
        cur.execute(
            """
            SELECT alias, entity_id
            FROM entity_alias
            WHERE entity_type = %s AND confidence >= %s
            ORDER BY alias
            """,
            (entity_type, min_confidence),
        )
        for row in cur.fetchall():
            key = normalise_org_name(str(row["alias"]))
            if not key:
                continue
            existing = mapping.get(key)
            if existing is not None and existing != row["entity_id"]:
                log.warning(
                    "alias.collision",
                    entity_type=entity_type,
                    normalised=key,
                    kept=existing,
                    ignored=row["entity_id"],
                )
                continue
            mapping[key] = str(row["entity_id"])

    log.info("alias.map_loaded", entity_type=entity_type, aliases=len(mapping))
    return mapping


# ---------------------------------------------------------------------------
# fiscal facts
# ---------------------------------------------------------------------------

_UPSERT_FACT_SQL = """
INSERT INTO fiscal_fact
  (fy, entity_type, entity_id, stage, head, period_start, period_end,
   is_cumulative, amount_inr_cr, source_record_id, extraction_method, is_provisional)
VALUES (%(fy)s, %(entity_type)s, %(entity_id)s, %(stage)s, %(head)s, %(period_start)s,
        %(period_end)s, %(is_cumulative)s, %(amount_inr_cr)s, %(source_record_id)s,
        %(extraction_method)s, %(is_provisional)s)
ON CONFLICT (fy, entity_type, entity_id, stage, head, period_start, period_end,
             source_record_id)
DO UPDATE SET
  amount_inr_cr     = EXCLUDED.amount_inr_cr,
  is_cumulative     = EXCLUDED.is_cumulative,
  extraction_method = EXCLUDED.extraction_method,
  is_provisional    = EXCLUDED.is_provisional
RETURNING fact_id
"""


def fact_params(row: FiscalFactRow, source_record_id: int) -> dict[str, Any]:
    """Bind parameters for one fact. Exposed so tests can assert the mapping."""
    return {
        "fy": row.fy,
        "entity_type": row.entity_type,
        "entity_id": row.entity_id,
        "stage": row.stage,
        "head": row.head,
        "period_start": row.period_start,
        "period_end": row.period_end,
        "is_cumulative": row.is_cumulative,
        "amount_inr_cr": quantize_crore(row.amount_inr_cr),
        "source_record_id": source_record_id,
        "extraction_method": row.extraction_method,
        "is_provisional": row.is_provisional,
    }


def upsert_fiscal_facts(
    conn: psycopg.Connection[dict[str, Any]],
    rows: Sequence[FiscalFactRow],
    *,
    source_record_id: int,
) -> int:
    """Insert or update facts, idempotent against ``fiscal_fact_natural_key``.

    Same document, same figure, run twice: one row, unchanged. A corrected
    figure arriving in the *same* document updates in place; a corrected figure
    arriving in a *new* document creates a new fact whose revision lineage is
    set by :func:`mark_superseded`, so the history of what each source said
    stays intact (docs/04 invariant on revisions).
    """
    if not rows:
        return 0
    written = 0
    with conn.cursor() as cur:
        for row in rows:
            cur.execute(_UPSERT_FACT_SQL, fact_params(row, source_record_id))
            if cur.fetchone() is not None:
                written += 1
    log.info("fiscal_fact.upserted", count=written, source_record_id=source_record_id)
    return written


def mark_superseded(
    conn: psycopg.Connection[dict[str, Any]],
    *,
    new_fact_id: int,
    superseded_fact_id: int,
) -> None:
    """Point a new fact at the one it revises. Never deletes the old row."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE fiscal_fact SET supersedes_fact_id = %s WHERE fact_id = %s",
            (superseded_fact_id, new_fact_id),
        )


# ---------------------------------------------------------------------------
# tenders, evidence, parse errors
# ---------------------------------------------------------------------------


def upsert_tenders(
    conn: psycopg.Connection[dict[str, Any]],
    rows: Sequence[TenderRow],
    *,
    source_record_id: int,
) -> int:
    if not rows:
        return 0
    written = 0
    with conn.cursor() as cur:
        for row in rows:
            cur.execute(
                """
                INSERT INTO tender
                  (tender_id, title, org_raw, ministry_id, scheme_id, value_inr_cr,
                   status, published_date, award_date, url, match_confidence, source_record_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (tender_id) DO UPDATE SET
                  title            = EXCLUDED.title,
                  org_raw          = EXCLUDED.org_raw,
                  ministry_id      = COALESCE(EXCLUDED.ministry_id, tender.ministry_id),
                  scheme_id        = COALESCE(EXCLUDED.scheme_id, tender.scheme_id),
                  value_inr_cr     = COALESCE(EXCLUDED.value_inr_cr, tender.value_inr_cr),
                  status           = EXCLUDED.status,
                  award_date       = COALESCE(EXCLUDED.award_date, tender.award_date),
                  match_confidence = EXCLUDED.match_confidence
                """,
                (
                    row.tender_id,
                    row.title,
                    row.org_raw,
                    row.ministry_id,
                    row.scheme_id,
                    quantize_crore(row.value_inr_cr) if row.value_inr_cr is not None else None,
                    row.status,
                    row.published_date,
                    row.award_date,
                    row.url,
                    row.match_confidence,
                    source_record_id,
                ),
            )
            written += 1
    return written


def record_parse_error(
    conn: psycopg.Connection[dict[str, Any]],
    *,
    reason: str,
    raw_context: Mapping[str, Any],
    source_record_id: int | None = None,
    pipeline_run_id: int | None = None,
    stage_hint: str | None = None,
) -> int:
    """Queue a row the parser could not confidently interpret.

    This is the destination for every ``AmbiguousAmountError``. docs/04 section
    5 forbids inferring a unit from context, so the row waits here for a human
    rather than entering the canonical store as a plausible guess.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO parse_error
              (source_record_id, pipeline_run_id, stage_hint, raw_context, reason)
            VALUES (%s, %s, %s, %s::jsonb, %s)
            RETURNING parse_error_id
            """,
            (
                source_record_id,
                pipeline_run_id,
                stage_hint,
                json.dumps(dict(raw_context), default=str),
                reason,
            ),
        )
        row = cur.fetchone()
    assert row is not None
    return int(row["parse_error_id"])


def record_parse_errors(
    conn: psycopg.Connection[dict[str, Any]],
    errors: Sequence[Mapping[str, Any]],
    *,
    source_record_id: int | None = None,
    pipeline_run_id: int | None = None,
) -> int:
    count = 0
    for error in errors:
        record_parse_error(
            conn,
            reason=str(error.get("reason", "unspecified")),
            raw_context=error.get("raw_context", error),
            source_record_id=source_record_id,
            pipeline_run_id=pipeline_run_id,
            stage_hint=error.get("stage_hint"),
        )
        count += 1
    return count


# ---------------------------------------------------------------------------
# views
# ---------------------------------------------------------------------------


def refresh_materialized_views(
    conn: psycopg.Connection[dict[str, Any]],
    *,
    concurrently: bool = True,
) -> None:
    """Refresh every dashboard view, in dependency order.

    Delegates to ``refresh_all_materialized_views`` in db/migrations/0005 so the
    order lives with the views themselves. CONCURRENTLY keeps the site up during
    the refresh and needs the unique indexes the migration declares; a first
    population after a restore has to pass ``concurrently=False``.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT refresh_all_materialized_views(%s)", (concurrently,))
    log.info("views.refreshed", concurrently=concurrently)


def check_invariants(
    conn: psycopg.Connection[dict[str, Any]],
    fy: str | None = None,
) -> list[dict[str, Any]]:
    """Run the docs/04 invariant checks and return anything that is not info."""
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM check_invariants(%s)", (fy,))
        return [dict(row) for row in cur.fetchall()]
