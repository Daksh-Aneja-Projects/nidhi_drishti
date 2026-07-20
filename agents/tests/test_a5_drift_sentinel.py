"""A5: alerting on drift, and pausing canonical writes without stopping staging."""

from __future__ import annotations

from decimal import Decimal

from agents.a5_drift_sentinel import DriftSentinel, FilePauseStore, in_memory_sentinel
from pipelines.lib.drift import RunMetrics


def metrics(rows: int, total: str | None = "1000", columns: tuple[str, ...] = ("a", "b")):
    return RunMetrics(
        row_count=rows,
        total_amount_inr_cr=Decimal(total) if total is not None else None,
        columns=columns,
    )


def history(*rows: int) -> list[RunMetrics]:
    return [metrics(count) for count in rows]


def test_a_consistent_run_produces_no_findings(agent_settings) -> None:
    sentinel = in_memory_sentinel(agent_settings)
    verdict = sentinel.check("cga_monthly", metrics(100), history(98, 101, 99))
    assert verdict.findings == ()
    assert verdict.canonical_writes_allowed


def test_zero_rows_pauses_canonical_writes(agent_settings) -> None:
    """A page that parses to nothing is a moved page, not a quiet month."""
    sentinel = in_memory_sentinel(agent_settings)
    verdict = sentinel.check("cga_monthly", metrics(0, total=None), history(100, 102, 98))

    assert verdict.paused
    assert not verdict.canonical_writes_allowed
    assert sentinel.is_paused("cga_monthly")
    assert "staging" in verdict.summary().lower()


def test_a_hundredfold_total_swing_pauses(agent_settings) -> None:
    """The lakh-for-crore misread. Every row validates and the total is 100x wrong."""
    sentinel = in_memory_sentinel(agent_settings)
    current = RunMetrics(row_count=100, total_amount_inr_cr=Decimal("100000"), columns=("a", "b"))
    past = [
        RunMetrics(row_count=100, total_amount_inr_cr=Decimal("1000"), columns=("a", "b"))
        for _ in range(3)
    ]
    verdict = sentinel.check("union_budget", current, past)

    assert verdict.severity == "high"
    assert verdict.paused


def test_a_moderate_swing_warns_without_pausing(agent_settings) -> None:
    sentinel = in_memory_sentinel(agent_settings)
    verdict = sentinel.check("cga_monthly", metrics(160), history(100, 100, 100))
    assert verdict.severity == "warn"
    assert not verdict.paused
    assert verdict.canonical_writes_allowed


def test_auto_pause_can_be_withheld_for_a_dry_run(agent_settings) -> None:
    sentinel = in_memory_sentinel(agent_settings)
    verdict = sentinel.check("cga_monthly", metrics(0, total=None), history(100), auto_pause=False)
    assert verdict.findings
    assert not verdict.paused
    assert not sentinel.is_paused("cga_monthly")


def test_resume_is_manual(agent_settings) -> None:
    """A human confirms the parser is fixed. Nothing un-pauses itself."""
    sentinel = in_memory_sentinel(agent_settings)
    sentinel.check("cga_monthly", metrics(0, total=None), history(100))
    assert sentinel.is_paused("cga_monthly")

    assert sentinel.resume("cga_monthly", note="parser fixed and backfilled")
    assert not sentinel.is_paused("cga_monthly")
    assert not sentinel.resume("cga_monthly"), "resuming twice reports that nothing changed"


def test_the_pause_register_survives_a_process_restart(agent_settings, tmp_path) -> None:
    """The pipeline and the sentinel are different processes."""
    path = tmp_path / "state" / "paused.json"
    first = DriftSentinel(settings=agent_settings, pause_store=FilePauseStore(path), alert=False)
    first.check("union_budget", metrics(0, total=None), history(500))

    second = DriftSentinel(settings=agent_settings, pause_store=FilePauseStore(path), alert=False)
    assert second.is_paused("union_budget")
    record = second.paused_sources()["union_budget"]
    assert record.source_id == "union_budget"
    assert record.reason


def test_pausing_one_source_does_not_pause_another(agent_settings) -> None:
    sentinel = in_memory_sentinel(agent_settings)
    sentinel.check("cga_monthly", metrics(0, total=None), history(100))
    assert sentinel.is_paused("cga_monthly")
    assert not sentinel.is_paused("union_budget")


def test_a_first_run_is_not_treated_as_suspicious(agent_settings) -> None:
    sentinel = in_memory_sentinel(agent_settings)
    verdict = sentinel.check("pib", metrics(42), [])
    assert verdict.severity == "info"
    assert not verdict.paused


def test_the_sentinel_makes_no_model_call(agent_settings) -> None:
    """Arithmetic already answers the question, and determinism aids triage."""
    sentinel = in_memory_sentinel(agent_settings)
    assert not hasattr(sentinel, "client")
    sentinel.check("cga_monthly", metrics(100), history(100))
