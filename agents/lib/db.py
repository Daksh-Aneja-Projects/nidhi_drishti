"""Database access for the agent layer, behind a write guard.

docs/05 opens with the rule the whole layer exists under: **agents never write
fiscal facts**. A comment saying so would lose an argument with a deadline, so
the rule is a mechanism here instead.

Every statement an agent issues goes through :class:`GuardedCursor`. A statement
that writes is parsed for its target table and checked against
:data:`ALLOWED_WRITE_TABLES` - an *allowlist*, not a blocklist, so a table added
to the schema next month is forbidden by default rather than permitted by
oversight. ``evidence_item`` is narrower still: agents may update its ``summary``
column and nothing else, because the row itself is provenance-bearing ingestion
output.

The guard is defence in depth, not the only line. In production the agent
processes should also connect as a role whose grants match this allowlist. The
guard is what makes a mistake fail loudly in development, where there is usually
one superuser role and a hurry.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import psycopg
import structlog
from psycopg.rows import dict_row

from agents.lib.config import AgentSettings, get_agent_settings

log = structlog.get_logger(__name__)

#: The complete set of tables an agent may write. Anything not named here is
#: refused, including every table the ingestion layer owns.
ALLOWED_WRITE_TABLES: frozenset[str] = frozenset(
    {
        "anomaly_flag",
        "anomaly_flag_evidence",
        "verification_report",
        "entity_alias",
        "alias_review_queue",
        "agent_call",
        "evidence_item",  # UPDATE ... SET summary only, see _check_evidence_item
    }
)

#: Named explicitly so the error message can say *why* rather than only "not
#: allowed". These are the tables whose contents are fiscal facts or the
#: provenance chain behind them.
FISCAL_TABLES: frozenset[str] = frozenset(
    {"fiscal_fact", "source_record", "pipeline_run", "parse_error", "tender", "source_registry"}
)

#: Columns of ``evidence_item`` an agent may set. docs/05 A4: the agent writes a
#: two-sentence descriptive summary, never the title, url, date or embedding.
EVIDENCE_ITEM_WRITABLE_COLUMNS: frozenset[str] = frozenset({"summary"})

_WRITE_VERBS = (
    "insert",
    "update",
    "delete",
    "truncate",
    "copy",
    "merge",
    "drop",
    "alter",
    "create",
)

#: The optional leading quote matters: ``INSERT INTO "fiscal_fact"`` is a write
#: to fiscal_fact, and a pattern that only accepted bare identifiers would let
#: the quoted form through.
_IDENT = r"\"?[a-z_][a-z0-9_.\"]*"

_INSERT_RE = re.compile(rf"\binsert\s+into\s+(?:only\s+)?({_IDENT})", re.IGNORECASE)
# The negative lookbehind and lookahead keep ``ON CONFLICT DO UPDATE SET`` from
# being read as an update of a table called "set". Upserts are the normal shape
# of every write in this package, so getting this wrong would refuse everything.
_UPDATE_RE = re.compile(rf"(?<!do )\bupdate\s+(?:only\s+)?(?!set\b)({_IDENT})", re.IGNORECASE)
_DELETE_RE = re.compile(rf"\bdelete\s+from\s+(?:only\s+)?({_IDENT})", re.IGNORECASE)
_TRUNCATE_RE = re.compile(rf"\btruncate\s+(?:table\s+)?({_IDENT})", re.IGNORECASE)
_MERGE_RE = re.compile(rf"\bmerge\s+into\s+({_IDENT})", re.IGNORECASE)
_DDL_RE = re.compile(r"^\s*(drop|alter|create)\b", re.IGNORECASE)
_UPDATE_SET_RE = re.compile(r"\bset\b(.*?)(?:\bwhere\b|\breturning\b|$)", re.IGNORECASE | re.DOTALL)
_ASSIGNMENT_RE = re.compile(r"([a-z_][a-z0-9_]*)\s*=", re.IGNORECASE)
_LINE_COMMENT_RE = re.compile(r"--[^\n]*")
_BLOCK_COMMENT_RE = re.compile(r"/\*.*?\*/", re.DOTALL)
_STRING_RE = re.compile(r"'(?:[^']|'')*'", re.DOTALL)

#: NUMERIC(20,2) in INR crore. Quantised here so the value we log is the value
#: that was stored.
_CRORE_QUANTUM = Decimal("0.01")


class FiscalWriteForbidden(PermissionError):
    """Raised when an agent statement tries to write outside its allowlist."""


def quantize_crore(amount: Decimal) -> Decimal:
    return amount.quantize(_CRORE_QUANTUM, rounding=ROUND_HALF_UP)


def _strip_noise(sql: str) -> str:
    """Remove comments and string literals before looking for a target table.

    A table name inside a quoted string (a rule explanation that mentions
    ``fiscal_fact``, say) is data, not a write target, and must not trip the
    guard. Comments are removed so ``-- update fiscal_fact`` is not read as one.
    """
    without_strings = _STRING_RE.sub("''", sql)
    without_block = _BLOCK_COMMENT_RE.sub(" ", without_strings)
    return _LINE_COMMENT_RE.sub(" ", without_block)


def _normalise_table(raw: str) -> str:
    name = raw.strip().strip('"').lower()
    if "." in name:
        name = name.rsplit(".", 1)[1]
    return name.strip('"')


def statement_write_targets(sql: str) -> list[str]:
    """Every table this statement writes to, lowercased and unqualified.

    Empty for a pure read. CTEs that contain a data-modifying statement are
    covered because the regexes scan the whole statement rather than only its
    leading verb.
    """
    cleaned = _strip_noise(sql)
    targets: list[str] = []
    for pattern in (_INSERT_RE, _UPDATE_RE, _DELETE_RE, _TRUNCATE_RE, _MERGE_RE):
        targets.extend(_normalise_table(match.group(1)) for match in pattern.finditer(cleaned))
    return targets


def is_write_statement(sql: str) -> bool:
    cleaned = _strip_noise(sql).lstrip().lower()
    return cleaned.startswith(_WRITE_VERBS) or bool(statement_write_targets(sql))


def _check_evidence_item(sql: str) -> None:
    cleaned = _strip_noise(sql)
    if _INSERT_RE.search(cleaned) or _DELETE_RE.search(cleaned) or _TRUNCATE_RE.search(cleaned):
        raise FiscalWriteForbidden(
            "Agents may only UPDATE evidence_item.summary. Inserting or deleting an evidence "
            "row is ingestion work: the row carries a source_record_id and must come from a "
            "pipeline that fetched and stored the artifact (docs/05)."
        )
    set_clause = _UPDATE_SET_RE.search(cleaned)
    if set_clause is None:
        raise FiscalWriteForbidden("An evidence_item UPDATE must carry an explicit SET clause.")
    columns = {name.lower() for name in _ASSIGNMENT_RE.findall(set_clause.group(1))}
    forbidden = columns - EVIDENCE_ITEM_WRITABLE_COLUMNS
    if forbidden:
        raise FiscalWriteForbidden(
            f"Agents may only set evidence_item.summary; this statement also sets "
            f"{sorted(forbidden)}."
        )


def assert_write_allowed(sql: str) -> None:
    """Raise unless every write target of ``sql`` is on the allowlist.

    This is the function that makes the docs/05 rule structural. Every agent
    write in this package passes through it.
    """
    cleaned = _strip_noise(sql)
    if _DDL_RE.match(cleaned):
        raise FiscalWriteForbidden(
            "Agents do not issue DDL. The schema is owned by db/migrations (docs/04)."
        )
    targets = statement_write_targets(sql)
    for table in targets:
        if table in FISCAL_TABLES:
            raise FiscalWriteForbidden(
                f"Refusing to write to {table!r}. Agents never write fiscal facts or their "
                f"provenance chain (docs/05). They write flags, reports, summaries and alias "
                f"suggestions, and nothing else."
            )
        if table not in ALLOWED_WRITE_TABLES:
            raise FiscalWriteForbidden(
                f"Refusing to write to {table!r}: it is not on the agent write allowlist "
                f"{sorted(ALLOWED_WRITE_TABLES)}. A new destination has to be added to the "
                f"allowlist deliberately, with a reason."
            )
        if table == "evidence_item":
            _check_evidence_item(sql)


class GuardedCursor:
    """A psycopg cursor that refuses writes outside the agent allowlist."""

    __slots__ = ("_cursor",)

    def __init__(self, cursor: Any) -> None:
        self._cursor = cursor

    def execute(self, query: Any, params: Any = None, **kwargs: Any) -> GuardedCursor:
        assert_write_allowed(_as_text(query))
        self._cursor.execute(query, params, **kwargs)
        return self

    def executemany(self, query: Any, params_seq: Any, **kwargs: Any) -> None:
        assert_write_allowed(_as_text(query))
        self._cursor.executemany(query, params_seq, **kwargs)

    def fetchone(self) -> Any:
        return self._cursor.fetchone()

    def fetchall(self) -> list[Any]:
        return list(self._cursor.fetchall())

    def fetchmany(self, size: int | None = None) -> list[Any]:
        return list(self._cursor.fetchmany(size) if size is not None else self._cursor.fetchmany())

    def __iter__(self) -> Iterator[Any]:
        return iter(self._cursor)

    def __enter__(self) -> GuardedCursor:
        self._cursor.__enter__()
        return self

    def __exit__(self, *exc_info: Any) -> None:
        self._cursor.__exit__(*exc_info)

    @property
    def rowcount(self) -> int:
        return int(self._cursor.rowcount)


def _as_text(query: Any) -> str:
    if isinstance(query, bytes):
        return query.decode("utf-8", errors="replace")
    if isinstance(query, str):
        return query
    # psycopg.sql.Composed and friends render through str() well enough for the
    # guard's purposes; anything unrenderable is treated as a write and checked.
    return str(query)


class GuardedConnection:
    """Wraps a psycopg connection so every cursor it hands out is guarded.

    Attribute access falls through to the underlying connection for commit,
    rollback and the rest, so callers use it exactly like a psycopg connection.
    """

    __slots__ = ("_conn",)

    def __init__(self, conn: Any) -> None:
        self._conn = conn

    def cursor(self, *args: Any, **kwargs: Any) -> GuardedCursor:
        return GuardedCursor(self._conn.cursor(*args, **kwargs))

    def execute(self, query: Any, params: Any = None, **kwargs: Any) -> GuardedCursor:
        assert_write_allowed(_as_text(query))
        return GuardedCursor(self._conn.execute(query, params, **kwargs))

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()

    def close(self) -> None:
        self._conn.close()

    def __getattr__(self, item: str) -> Any:
        return getattr(self._conn, item)


@contextmanager
def connect(settings: AgentSettings | None = None) -> Iterator[GuardedConnection]:
    """Open a guarded connection, committed on clean exit and rolled back on error."""
    resolved = settings or get_agent_settings()
    with psycopg.connect(resolved.database_url, row_factory=dict_row) as raw:
        guarded = GuardedConnection(raw)
        try:
            yield guarded
            raw.commit()
        except BaseException:
            raw.rollback()
            raise


# ---------------------------------------------------------------------------
# agent_call: the telemetry every agent call writes (docs/09 plane B)
# ---------------------------------------------------------------------------

INSERT_AGENT_CALL_SQL = """
INSERT INTO agent_call
  (agent_id, model, prompt_version, input_tokens, output_tokens, latency_ms,
   validation_passed, entity_type, entity_id, error_text)
VALUES (%(agent_id)s, %(model)s, %(prompt_version)s, %(input_tokens)s, %(output_tokens)s,
        %(latency_ms)s, %(validation_passed)s, %(entity_type)s, %(entity_id)s, %(error_text)s)
RETURNING call_id
"""


def record_agent_call(conn: GuardedConnection, params: Mapping[str, Any]) -> int:
    with conn.cursor() as cur:
        cur.execute(INSERT_AGENT_CALL_SQL, dict(params))
        row = cur.fetchone()
    assert row is not None
    return int(row["call_id"])


# ---------------------------------------------------------------------------
# anomaly_flag (A3)
# ---------------------------------------------------------------------------

UPSERT_ANOMALY_FLAG_SQL = """
INSERT INTO anomaly_flag
  (rule_id, entity_type, entity_id, fy, severity, metric, explanation, status)
VALUES (%(rule_id)s, %(entity_type)s, %(entity_id)s, %(fy)s, %(severity)s,
        %(metric)s::jsonb, %(explanation)s, %(status)s)
ON CONFLICT (rule_id, entity_type, entity_id, fy) DO UPDATE SET
  severity    = EXCLUDED.severity,
  metric      = EXCLUDED.metric,
  explanation = EXCLUDED.explanation,
  -- A flag a human already reviewed keeps its decision. Re-running the rules
  -- must not quietly un-approve or re-open a settled flag.
  status      = CASE WHEN anomaly_flag.status = 'pending'
                     THEN EXCLUDED.status ELSE anomaly_flag.status END
RETURNING flag_id
"""


def upsert_anomaly_flag(conn: GuardedConnection, params: Mapping[str, Any]) -> int:
    payload = dict(params)
    payload["metric"] = json.dumps(payload.get("metric") or {}, default=str)
    with conn.cursor() as cur:
        cur.execute(UPSERT_ANOMALY_FLAG_SQL, payload)
        row = cur.fetchone()
    assert row is not None
    return int(row["flag_id"])


LINK_FLAG_EVIDENCE_SQL = """
INSERT INTO anomaly_flag_evidence (flag_id, evidence_id)
VALUES (%s, %s)
ON CONFLICT DO NOTHING
"""


def link_flag_evidence(conn: GuardedConnection, flag_id: int, evidence_ids: Sequence[int]) -> int:
    if not evidence_ids:
        return 0
    with conn.cursor() as cur:
        for evidence_id in evidence_ids:
            cur.execute(LINK_FLAG_EVIDENCE_SQL, (flag_id, evidence_id))
    return len(evidence_ids)


# ---------------------------------------------------------------------------
# verification_report (A4)
# ---------------------------------------------------------------------------

INSERT_VERIFICATION_REPORT_SQL = """
INSERT INTO verification_report
  (entity_type, entity_id, fy, narrative_md, citations, confidence,
   self_check_passed, is_fallback, model, prompt_version)
VALUES (%(entity_type)s, %(entity_id)s, %(fy)s, %(narrative_md)s, %(citations)s::jsonb,
        %(confidence)s, %(self_check_passed)s, %(is_fallback)s, %(model)s, %(prompt_version)s)
RETURNING report_id
"""


def insert_verification_report(conn: GuardedConnection, params: Mapping[str, Any]) -> int:
    payload = dict(params)
    payload["citations"] = json.dumps(payload.get("citations") or [], default=str)
    with conn.cursor() as cur:
        cur.execute(INSERT_VERIFICATION_REPORT_SQL, payload)
        row = cur.fetchone()
    assert row is not None
    return int(row["report_id"])


# ---------------------------------------------------------------------------
# entity_alias / alias_review_queue (A2)
# ---------------------------------------------------------------------------

UPSERT_ENTITY_ALIAS_SQL = """
INSERT INTO entity_alias (alias, entity_type, entity_id, source_id, confidence, resolved_by)
VALUES (%(alias)s, %(entity_type)s, %(entity_id)s, %(source_id)s, %(confidence)s, %(resolved_by)s)
ON CONFLICT (alias, entity_type) DO UPDATE SET
  entity_id   = EXCLUDED.entity_id,
  confidence  = EXCLUDED.confidence,
  resolved_by = EXCLUDED.resolved_by
-- A hand-verified mapping outranks anything a machine proposes later.
WHERE entity_alias.resolved_by <> 'human'
"""


def upsert_entity_alias(conn: GuardedConnection, params: Mapping[str, Any]) -> None:
    with conn.cursor() as cur:
        cur.execute(UPSERT_ENTITY_ALIAS_SQL, dict(params))


QUEUE_ALIAS_REVIEW_SQL = """
INSERT INTO alias_review_queue (raw_name, entity_type, source_id, suggestions)
VALUES (%(raw_name)s, %(entity_type)s, %(source_id)s, %(suggestions)s::jsonb)
ON CONFLICT (raw_name, entity_type) DO UPDATE SET
  suggestions = EXCLUDED.suggestions
WHERE alias_review_queue.status = 'pending'
"""


def queue_alias_review(conn: GuardedConnection, params: Mapping[str, Any]) -> None:
    payload = dict(params)
    payload["suggestions"] = json.dumps(payload.get("suggestions") or [], default=str)
    with conn.cursor() as cur:
        cur.execute(QUEUE_ALIAS_REVIEW_SQL, payload)


# ---------------------------------------------------------------------------
# evidence_item.summary (A4 retrieval side)
# ---------------------------------------------------------------------------

UPDATE_EVIDENCE_SUMMARY_SQL = """
UPDATE evidence_item SET summary = %s WHERE evidence_id = %s
"""


def update_evidence_summary(conn: GuardedConnection, evidence_id: int, summary: str) -> None:
    with conn.cursor() as cur:
        cur.execute(UPDATE_EVIDENCE_SUMMARY_SQL, (summary, evidence_id))


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------


def fetch_all(conn: GuardedConnection, sql: str, params: Any = None) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return [dict(row) for row in cur.fetchall()]


def fetch_one(conn: GuardedConnection, sql: str, params: Any = None) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
    return dict(row) if row is not None else None


def utcnow() -> datetime:
    from datetime import UTC

    return datetime.now(UTC)
