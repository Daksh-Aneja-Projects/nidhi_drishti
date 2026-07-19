"""The guarantee: agents never write fiscal facts.

docs/05 states it and :mod:`agents.lib.db` enforces it. These tests are the proof
that the enforcement is real rather than aspirational, and they are the ones to
read first if the rule is ever questioned.

Three layers of check:

1. The guard refuses a write to ``fiscal_fact`` however it is phrased.
2. The guard is an allowlist, so a table nobody thought about is refused too.
3. Every SQL constant shipped in ``agents/`` is fed through the guard, so a
   forbidden statement cannot be added to the package without a failing test.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from agents.lib.db import (
    ALLOWED_WRITE_TABLES,
    FISCAL_TABLES,
    FiscalWriteForbidden,
    GuardedConnection,
    assert_write_allowed,
    statement_write_targets,
)

AGENTS_ROOT = Path(__file__).resolve().parents[1]


FORBIDDEN_STATEMENTS = [
    "INSERT INTO fiscal_fact (fy, amount_inr_cr) VALUES ('FY2026', 1)",
    "insert into fiscal_fact select * from staging_fact",
    "INSERT INTO public.fiscal_fact (fy) VALUES ('FY2026')",
    'INSERT INTO "fiscal_fact" (fy) VALUES (\'FY2026\')',
    "UPDATE fiscal_fact SET amount_inr_cr = 0 WHERE fact_id = 1",
    "UPDATE ONLY fiscal_fact SET amount_inr_cr = 0",
    "DELETE FROM fiscal_fact WHERE fact_id = 1",
    "TRUNCATE TABLE fiscal_fact",
    "TRUNCATE fiscal_fact",
    "MERGE INTO fiscal_fact USING staging ON true WHEN MATCHED THEN DO NOTHING",
    "WITH x AS (SELECT 1) INSERT INTO fiscal_fact (fy) SELECT 'FY2026'",
    "INSERT INTO source_record (source_id) VALUES ('pib')",
    "UPDATE pipeline_run SET status = 'ok'",
    "INSERT INTO tender (tender_id) VALUES ('x')",
    "INSERT INTO parse_error (reason) VALUES ('x')",
    "DROP TABLE fiscal_fact",
    "ALTER TABLE anomaly_flag ADD COLUMN sneaky TEXT",
    "CREATE TABLE shadow_fact (id INT)",
    # Not a fiscal table, but not on the allowlist either. An allowlist means a
    # table nobody has thought about is refused by default.
    "INSERT INTO correction (reporter_note) VALUES ('x')",
    "UPDATE ministry SET name = 'x'",
]


@pytest.mark.parametrize("sql", FORBIDDEN_STATEMENTS)
def test_guard_refuses_forbidden_writes(sql: str) -> None:
    with pytest.raises(FiscalWriteForbidden):
        assert_write_allowed(sql)


ALLOWED_STATEMENTS = [
    "INSERT INTO anomaly_flag (rule_id) VALUES ('over_burn')",
    "INSERT INTO anomaly_flag_evidence (flag_id, evidence_id) VALUES (1, 2)",
    "INSERT INTO verification_report (entity_id) VALUES ('min-x')",
    "INSERT INTO entity_alias (alias) VALUES ('x')",
    "INSERT INTO alias_review_queue (raw_name) VALUES ('x')",
    "INSERT INTO agent_call (agent_id) VALUES ('A4')",
    "UPDATE evidence_item SET summary = 'two sentences' WHERE evidence_id = 3",
    # Reads are never write targets, whatever they mention.
    "SELECT * FROM fiscal_fact WHERE fy = 'FY2026'",
    "SELECT * FROM v_fiscal_fact_current",
    "SELECT * FROM mv_ministry_summary WHERE fy = 'FY2026'",
]


@pytest.mark.parametrize("sql", ALLOWED_STATEMENTS)
def test_guard_permits_the_agent_allowlist(sql: str) -> None:
    assert_write_allowed(sql)


def test_evidence_item_is_summary_only() -> None:
    assert_write_allowed("UPDATE evidence_item SET summary = 'x' WHERE evidence_id = 1")
    with pytest.raises(FiscalWriteForbidden, match="only set evidence_item.summary"):
        assert_write_allowed("UPDATE evidence_item SET title = 'x' WHERE evidence_id = 1")
    with pytest.raises(FiscalWriteForbidden, match="only set evidence_item.summary"):
        assert_write_allowed(
            "UPDATE evidence_item SET summary = 'x', ministry_id = 'min-y' WHERE evidence_id = 1"
        )
    with pytest.raises(FiscalWriteForbidden, match="only UPDATE evidence_item"):
        assert_write_allowed("INSERT INTO evidence_item (kind, title) VALUES ('pib', 't')")
    with pytest.raises(FiscalWriteForbidden, match="only UPDATE evidence_item"):
        assert_write_allowed("DELETE FROM evidence_item WHERE evidence_id = 1")


def test_a_table_name_inside_a_string_literal_is_data_not_a_target() -> None:
    """A flag explanation that mentions a table must not trip the guard."""
    sql = (
        "INSERT INTO anomaly_flag (rule_id, explanation) "
        "VALUES ('over_burn', 'Derived from fiscal_fact rows; update fiscal_fact is not implied.')"
    )
    assert_write_allowed(sql)
    assert statement_write_targets(sql) == ["anomaly_flag"]


def test_a_commented_out_write_is_not_a_target() -> None:
    sql = """
    -- INSERT INTO fiscal_fact (fy) VALUES ('FY2026')
    /* UPDATE fiscal_fact SET amount_inr_cr = 0 */
    INSERT INTO agent_call (agent_id) VALUES ('A3')
    """
    assert_write_allowed(sql)
    assert statement_write_targets(sql) == ["agent_call"]


def test_guarded_connection_blocks_at_the_cursor(conn: GuardedConnection, raw_conn) -> None:
    """The guard sits on the connection, so no caller can route around it."""
    with pytest.raises(FiscalWriteForbidden):
        with conn.cursor() as cur:
            cur.execute("INSERT INTO fiscal_fact (fy) VALUES (%s)", ("FY2026",))
    with pytest.raises(FiscalWriteForbidden):
        conn.execute("UPDATE fiscal_fact SET amount_inr_cr = 0")
    assert raw_conn.executed == [], "the statement must never reach the driver"


def test_allowlist_and_fiscal_tables_do_not_overlap() -> None:
    assert not (ALLOWED_WRITE_TABLES & FISCAL_TABLES)
    assert "fiscal_fact" not in ALLOWED_WRITE_TABLES


def _string_constants(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return [
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    ]


def test_every_sql_constant_in_the_package_passes_the_guard() -> None:
    """Static sweep: no shipped statement may violate the allowlist.

    Catches the realistic regression, which is not somebody defiantly writing to
    ``fiscal_fact`` but somebody adding a helper that writes to a table the rule
    never contemplated.
    """
    offenders: list[str] = []
    for path in sorted(AGENTS_ROOT.rglob("*.py")):
        if "tests" in path.parts:
            continue
        for value in _string_constants(path):
            lowered = value.lower()
            if not any(
                verb in lowered
                for verb in ("insert into", "update ", "delete from", "truncate ", "merge into")
            ):
                continue
            if not statement_write_targets(value):
                continue
            try:
                assert_write_allowed(value)
            except FiscalWriteForbidden as exc:
                offenders.append(f"{path.relative_to(AGENTS_ROOT)}: {exc}")
    assert not offenders, "SQL in the agents package violates the write allowlist:\n" + "\n".join(
        offenders
    )
