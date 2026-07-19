"""Drift detection tests, docs/02 section 5.

The point of these checks is to catch the failure where a page still parses and
the numbers are wrong. Every case here is one of those.
"""

from __future__ import annotations

from decimal import Decimal

from pipelines.lib.drift import (
    DriftFinding,
    RunMetrics,
    sanity_check,
    should_abort,
    worst_severity,
)


def metrics(
    rows: int,
    total: str | None = None,
    columns: tuple[str, ...] = ("ministry", "expenditure"),
    errors: int = 0,
) -> RunMetrics:
    return RunMetrics(
        row_count=rows,
        total_amount_inr_cr=Decimal(total) if total is not None else None,
        columns=columns,
        parse_error_count=errors,
    )


def checks(findings: list[DriftFinding]) -> set[str]:
    return {finding.check for finding in findings}


class TestNoBaseline:
    def test_first_run_is_reported_not_alarmed_about(self) -> None:
        findings = sanity_check(metrics(100, "5000"), [])
        assert checks(findings) == {"no_baseline"}
        assert not should_abort(findings)

    def test_first_run_with_zero_rows_still_aborts(self) -> None:
        findings = sanity_check(metrics(0), [])
        assert "zero_rows" in checks(findings)
        assert should_abort(findings)


class TestRowCountSwing:
    def test_stable_row_count_is_clean(self) -> None:
        history = [metrics(100, "5000"), metrics(102, "5100"), metrics(98, "4900")]
        assert sanity_check(metrics(101, "5050"), history) == []

    def test_row_count_halving_is_flagged(self) -> None:
        history = [metrics(100, "5000"), metrics(100, "5000")]
        findings = sanity_check(metrics(40, "5000"), history)
        assert "row_count_swing" in checks(findings)

    def test_a_severe_swing_aborts(self) -> None:
        history = [metrics(100, "5000"), metrics(100, "5000")]
        findings = sanity_check(metrics(3, "5000"), history)
        assert should_abort(findings)

    def test_a_moderate_swing_warns_without_aborting(self) -> None:
        history = [metrics(100, "5000"), metrics(100, "5000")]
        findings = sanity_check(metrics(160, "5000"), history)
        assert checks(findings) == {"row_count_swing"}
        assert worst_severity(findings) == "warn"
        assert not should_abort(findings)

    def test_the_median_not_the_last_run_is_the_baseline(self) -> None:
        """One odd run must not become the baseline that hides the next one."""
        history = [metrics(10, "5000"), metrics(100, "5000"), metrics(100, "5000")]
        assert "row_count_swing" not in checks(sanity_check(metrics(100, "5000"), history))


class TestTotalSwing:
    def test_a_hundredfold_swing_is_caught_even_when_rows_are_stable(self) -> None:
        """The lakh-read-as-crore failure. Every row validates and the total is wrong."""
        history = [metrics(100, "5000"), metrics(100, "5000")]
        findings = sanity_check(metrics(100, "500000"), history)
        assert "total_amount_swing" in checks(findings)
        assert should_abort(findings)

    def test_normal_month_on_month_growth_is_clean(self) -> None:
        history = [metrics(100, "5000"), metrics(100, "5400"), metrics(100, "5200")]
        assert sanity_check(metrics(100, "5600"), history) == []

    def test_a_missing_total_is_not_a_finding(self) -> None:
        history = [metrics(100, "5000")]
        assert "total_amount_swing" not in checks(sanity_check(metrics(100, None), history))


class TestColumnSet:
    def test_a_new_column_warns(self) -> None:
        history = [metrics(100, "5000", columns=("ministry", "expenditure"))]
        findings = sanity_check(
            metrics(100, "5000", columns=("ministry", "expenditure", "revised")), history
        )
        assert "column_set_change" in checks(findings)
        assert worst_severity(findings) == "warn"

    def test_a_removed_column_aborts(self) -> None:
        history = [metrics(100, "5000", columns=("ministry", "expenditure"))]
        findings = sanity_check(metrics(100, "5000", columns=("ministry",)), history)
        assert should_abort(findings)

    def test_reordering_is_not_a_change(self) -> None:
        history = [metrics(100, "5000", columns=("ministry", "expenditure"))]
        findings = sanity_check(
            metrics(100, "5000", columns=("expenditure", "ministry")), history
        )
        assert "column_set_change" not in checks(findings)


class TestParseErrorRate:
    def test_a_handful_of_errors_is_informational(self) -> None:
        findings = sanity_check(metrics(1000, "5000", errors=5), [metrics(1000, "5000")])
        finding = next(f for f in findings if f.check == "parse_error_rate")
        assert finding.severity == "info"

    def test_a_rising_rate_warns(self) -> None:
        findings = sanity_check(metrics(100, "5000", errors=5), [metrics(100, "5000")])
        finding = next(f for f in findings if f.check == "parse_error_rate")
        assert finding.severity == "warn"

    def test_a_high_rate_aborts(self) -> None:
        findings = sanity_check(metrics(80, "5000", errors=20), [metrics(100, "5000")])
        assert should_abort(findings)

    def test_no_errors_produces_no_finding(self) -> None:
        assert "parse_error_rate" not in checks(
            sanity_check(metrics(100, "5000"), [metrics(100, "5000")])
        )


class TestMetricsSerialisation:
    def test_round_trip_keeps_decimal_precision(self) -> None:
        original = RunMetrics(
            row_count=412,
            total_amount_inr_cr=Decimal("5065345.67"),
            columns=("a", "b"),
            parse_error_count=2,
            extra={"note": "test"},
        )
        restored = RunMetrics.from_jsonable(original.to_jsonable())
        assert restored == original
        assert restored.total_amount_inr_cr == Decimal("5065345.67")

    def test_jsonable_is_json_serialisable(self) -> None:
        import json

        payload = RunMetrics(row_count=1, total_amount_inr_cr=Decimal("1.5")).to_jsonable()
        assert json.loads(json.dumps(payload))["total_amount_inr_cr"] == "1.5"

    def test_findings_are_json_serialisable(self) -> None:
        import json

        findings = sanity_check(metrics(0), [])
        json.dumps([finding.to_jsonable() for finding in findings])
