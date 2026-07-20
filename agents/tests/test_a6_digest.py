"""A6: assembly of approved content, and nothing else."""

from __future__ import annotations

from datetime import date

from agents.a6_digest import DISCLAIMER, DigestAgent

APPROVED_FLAG = {
    "flag_id": 1,
    "rule_id": "under_utilization",
    "entity_type": "ministry",
    "entity_id": "min-fixture",
    "entity_label": "Ministry of Fixture",
    "fy": "FY2026",
    "severity": "notable",
    "metric": {
        "burn_ratio": "0.40",
        "does_not_show": "This does not show that funds were withheld or misdirected.",
    },
    "explanation": "Expenditure stood at a burn ratio of 0.40 with 75.0 percent of the year elapsed.",
    "reviewed_at": "2026-07-19T10:00:00Z",
}

EVIDENCE = {
    "evidence_id": 71,
    "kind": "pib",
    "title": "Fixture Water review meeting held",
    "url": "https://pib.gov.in/fixture",
    "published_date": date(2026, 7, 18),
    "summary": "The release describes a review meeting on programme progress.",
    "entity_label": "Ministry of Fixture",
}


def test_digest_renders_approved_flags_and_evidence(conn, raw_conn) -> None:
    raw_conn.route("FROM anomaly_flag f", [APPROVED_FLAG])
    raw_conn.route("FROM evidence_item e", [EVIDENCE])

    digest = DigestAgent(conn).build(since=date(2026, 7, 18), generated_for=date(2026, 7, 20))
    markdown = digest.to_markdown(site_url="https://example.org")

    assert "Ministry of Fixture" in markdown
    assert "burn ratio of 0.40" in markdown
    assert "What this does not show:" in markdown
    assert "Fixture Water review meeting held" in markdown
    assert DISCLAIMER in markdown
    assert "https://example.org/ministry/min-fixture?fy=FY2026" in markdown


def test_only_approved_flags_are_queried(conn, raw_conn) -> None:
    """The status filter is in the SQL, not in a Python branch somebody can skip."""
    raw_conn.route("FROM anomaly_flag f", [])
    raw_conn.route("FROM evidence_item e", [])
    DigestAgent(conn).build(since=date(2026, 7, 18))

    flag_sql = next(sql for sql in raw_conn.statements_touching("anomaly_flag"))
    assert "status = 'approved'" in flag_sql


def test_an_empty_period_says_so_plainly(conn, raw_conn) -> None:
    raw_conn.route("FROM anomaly_flag f", [])
    raw_conn.route("FROM evidence_item e", [])
    digest = DigestAgent(conn).build(since=date(2026, 7, 18), generated_for=date(2026, 7, 20))

    assert digest.is_empty
    markdown = digest.to_markdown()
    assert "Nothing is being reported today" in markdown
    assert DISCLAIMER in markdown


def test_a_flag_with_banned_vocabulary_is_dropped(conn, raw_conn) -> None:
    """An approved flag has been through a human. Email is still the least reversible surface."""
    bad = {**APPROVED_FLAG, "explanation": "The pattern suggests funds were siphoned."}
    raw_conn.route("FROM anomaly_flag f", [bad])
    raw_conn.route("FROM evidence_item e", [])

    digest = DigestAgent(conn).build(since=date(2026, 7, 18))

    assert digest.flags == ()
    assert "siphon" not in digest.to_markdown().lower()


def test_flags_are_ordered_by_severity(conn, raw_conn) -> None:
    high = {**APPROVED_FLAG, "flag_id": 2, "severity": "high", "entity_label": "Zeta Ministry"}
    info = {**APPROVED_FLAG, "flag_id": 3, "severity": "info", "entity_label": "Alpha Ministry"}
    raw_conn.route("FROM anomaly_flag f", [info, APPROVED_FLAG, high])
    raw_conn.route("FROM evidence_item e", [])

    digest = DigestAgent(conn).build(since=date(2026, 7, 18))

    assert [f["severity"] for f in digest.flags] == ["high", "notable", "info"]


def test_the_digest_makes_no_model_call(conn) -> None:
    """docs/05 A6: pure assembly, so there is nothing here that could invent a claim."""
    agent = DigestAgent(conn)
    assert not hasattr(agent, "client")
