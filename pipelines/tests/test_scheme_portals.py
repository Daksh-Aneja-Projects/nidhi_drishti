"""Scheme-portal parser tests (docs/03 section 2.6, roadmap v1.1).

No network, no database. Each source is exercised the same way the existing
suite exercises the others:

* the happy path, against markup shaped like the real page;
* the unit-missing path, which must produce parse errors rather than numbers;
* the moved-or-restructured path, which must produce zero rows so the drift
  check turns it into a high-severity finding instead of a crash.

Two invariants specific to these portals get their own tests: RELEASE and
UTILIZATION are never conflated, and PM-KISAN never ingests beneficiary-level
data (docs/08 section 4).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

from pipelines.lib.drift import RunMetrics, sanity_check, should_abort
from pipelines.lib.validation import validate_rows
from pipelines.sources.jal_jeevan.pipeline import (
    SCHEME_ID as JJM_SCHEME_ID,
)
from pipelines.sources.jal_jeevan.pipeline import (
    JjmFundingRow,
)
from pipelines.sources.jal_jeevan.pipeline import (
    parse_dashboard as parse_jjm_dashboard,
)
from pipelines.sources.jal_jeevan.pipeline import (
    to_facts as jjm_to_facts,
)
from pipelines.sources.mgnrega.pipeline import (
    SCHEME_ID as MGNREGA_SCHEME_ID,
)
from pipelines.sources.mgnrega.pipeline import (
    MgnregaFinancialRow,
    classify_stage,
    parse_financial_progress,
)
from pipelines.sources.mgnrega.pipeline import (
    to_facts as mgnrega_to_facts,
)
from pipelines.sources.pmkisan.pipeline import (
    SCHEME_ID as PMKISAN_SCHEME_ID,
)
from pipelines.sources.pmkisan.pipeline import (
    PmKisanAggregateRow,
    is_beneficiary_level,
)
from pipelines.sources.pmkisan.pipeline import (
    parse_dashboard as parse_pmkisan_dashboard,
)
from pipelines.sources.pmkisan.pipeline import (
    to_facts as pmkisan_to_facts,
)

FIXTURES = Path(__file__).parent / "fixtures"
AS_OF = date(2025, 11, 21)


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# MGNREGA
# ---------------------------------------------------------------------------


class TestMgnrega:
    def test_parses_release_and_utilization_from_the_statement(self) -> None:
        rows, errors, columns = parse_financial_progress(
            fixture("mgnrega_financial_progress.html"), as_of=AS_OF
        )
        assert errors == []
        stages = {row["stage"] for row in rows}
        assert stages == {"RELEASE", "UTILIZATION"}
        assert "Particulars" in columns[0]

    def test_reads_the_lakh_unit_from_the_caption_and_converts_to_crore(self) -> None:
        """The report is in lakh; 7,52,300 lakh is 7,523 crore, not 7,52,300."""
        rows, _, _ = parse_financial_progress(
            fixture("mgnrega_financial_progress.html"), as_of=AS_OF
        )
        release = next(row for row in rows if row["stage"] == "RELEASE")
        expenditure = next(row for row in rows if row["stage"] == "UTILIZATION")
        assert release["amount_inr_cr"] == Decimal("7523.00")
        assert expenditure["amount_inr_cr"] == Decimal("6885.40")

    def test_state_release_and_ratios_are_not_mistaken_for_a_stage(self) -> None:
        rows, _, _ = parse_financial_progress(
            fixture("mgnrega_financial_progress.html"), as_of=AS_OF
        )
        labels = {row["label_raw"] for row in rows}
        assert "State Release" not in labels
        assert "Percentage Utilization" not in labels
        assert "Total Available Fund" not in labels

    def test_figures_are_flagged_cumulative(self) -> None:
        rows, _, _ = parse_financial_progress(
            fixture("mgnrega_financial_progress.html"), as_of=AS_OF
        )
        assert all(row["is_cumulative"] is True for row in rows)
        assert {row["fy"] for row in rows} == {"FY2026"}

    def test_without_a_stated_unit_every_figure_becomes_a_parse_error(self) -> None:
        rows, errors, _ = parse_financial_progress(
            fixture("mgnrega_financial_progress_no_unit.html"), as_of=AS_OF
        )
        assert rows == []
        assert len(errors) == 2
        assert all("no unit" in error["reason"] for error in errors)

    def test_rows_satisfy_the_schema(self) -> None:
        rows, _, _ = parse_financial_progress(
            fixture("mgnrega_financial_progress.html"), as_of=AS_OF
        )
        assert len(validate_rows(rows, MgnregaFinancialRow, source_id="mgnrega")) == len(rows)

    def test_a_moved_page_yields_no_rows_and_aborts_on_drift(self) -> None:
        rows, _, _ = parse_financial_progress(
            "<html><body><h1>Page not found</h1></body></html>", as_of=AS_OF
        )
        assert rows == []
        findings = sanity_check(RunMetrics(row_count=0), [RunMetrics(row_count=6)])
        assert should_abort(findings)

    def test_release_and_utilization_map_to_distinct_stages(self) -> None:
        """CLAUDE.md principle 2: the two stages are never conflated."""
        rows, _, _ = parse_financial_progress(
            fixture("mgnrega_financial_progress.html"), as_of=AS_OF
        )
        validated = validate_rows(rows, MgnregaFinancialRow, source_id="mgnrega")
        facts = mgnrega_to_facts(validated)
        assert len(facts) == 2
        by_stage = {fact.stage: fact for fact in facts}
        assert set(by_stage) == {"RELEASE", "UTILIZATION"}
        assert all(fact.entity_id == MGNREGA_SCHEME_ID for fact in facts)
        assert all(fact.entity_type == "scheme" for fact in facts)
        assert all(fact.is_cumulative and fact.is_provisional for fact in facts)
        assert by_stage["RELEASE"].period_end == AS_OF

    def test_expenditure_is_utilization_never_the_expenditure_stage(self) -> None:
        """Implementing-agency spend is UTILIZATION; EXPENDITURE is CGA-only."""
        rows, _, _ = parse_financial_progress(
            fixture("mgnrega_financial_progress.html"), as_of=AS_OF
        )
        validated = validate_rows(rows, MgnregaFinancialRow, source_id="mgnrega")
        facts = mgnrega_to_facts(validated)
        assert all(fact.stage != "EXPENDITURE" for fact in facts)

    def test_classify_stage_ignores_ratio_labels(self) -> None:
        assert classify_stage("Percentage Utilization") is None
        assert classify_stage("Central Release") == "RELEASE"
        assert classify_stage("Total Expenditure") == "UTILIZATION"


# ---------------------------------------------------------------------------
# PM-KISAN
# ---------------------------------------------------------------------------


class TestPmKisan:
    def test_parses_the_aggregate_funds_transferred(self) -> None:
        money, _counts, errors, _ = parse_pmkisan_dashboard(
            fixture("pmkisan_dashboard.html"), as_of=AS_OF
        )
        assert errors == []
        assert len(money) == 1
        assert money[0]["stage"] == "RELEASE"
        assert money[0]["amount_inr_cr"] == Decimal("21450.00")
        assert money[0]["fy"] == "FY2026"

    def test_beneficiary_count_is_kept_as_a_count_never_as_money(self) -> None:
        money, counts, _, _ = parse_pmkisan_dashboard(
            fixture("pmkisan_dashboard.html"), as_of=AS_OF
        )
        assert len(counts) == 1
        assert counts[0]["count"] == 110872455
        # The count never appears in a money amount.
        assert all(row["amount_inr_cr"] != Decimal(110872455) for row in money)

    def test_beneficiary_level_table_is_refused(self) -> None:
        """docs/08 section 4: row-level DBT data is never read, even for a total."""
        header = ["Registration No", "Beneficiary Name", "Village", "Amount"]
        assert is_beneficiary_level(header) is True
        money, _, _, _ = parse_pmkisan_dashboard(fixture("pmkisan_dashboard.html"), as_of=AS_OF)
        # The 6000 rupee per-beneficiary figure never enters the pipeline.
        assert all(row["amount_inr_cr"] != Decimal("6000") for row in money)
        assert all(row["amount_inr_cr"] != Decimal("0.00006") for row in money)

    def test_the_row_schema_cannot_carry_a_beneficiary_identifier(self) -> None:
        assert "beneficiary" not in PmKisanAggregateRow.model_fields
        assert set(PmKisanAggregateRow.model_fields) == {
            "stage",
            "label_raw",
            "fy",
            "amount_inr_cr",
            "as_of",
            "is_cumulative",
        }

    def test_funds_transferred_maps_to_release_for_the_dbt(self) -> None:
        money, _counts, _errors, _labels = parse_pmkisan_dashboard(
            fixture("pmkisan_dashboard.html"), as_of=AS_OF
        )
        validated = validate_rows(money, PmKisanAggregateRow, source_id="pmkisan")
        facts = pmkisan_to_facts(validated)
        assert len(facts) == 1
        assert facts[0].stage == "RELEASE"
        assert facts[0].entity_id == PMKISAN_SCHEME_ID
        assert facts[0].is_cumulative is True
        assert facts[0].period_end == AS_OF

    def test_rows_satisfy_the_schema(self) -> None:
        money, _, _, _ = parse_pmkisan_dashboard(fixture("pmkisan_dashboard.html"), as_of=AS_OF)
        assert len(validate_rows(money, PmKisanAggregateRow, source_id="pmkisan")) == 1

    def test_a_moved_page_yields_no_rows_and_aborts_on_drift(self) -> None:
        money, _, _, _ = parse_pmkisan_dashboard(
            "<html><body><p>Service unavailable</p></body></html>", as_of=AS_OF
        )
        assert money == []
        findings = sanity_check(RunMetrics(row_count=0), [RunMetrics(row_count=1)])
        assert should_abort(findings)


# ---------------------------------------------------------------------------
# Jal Jeevan Mission
# ---------------------------------------------------------------------------


class TestJalJeevan:
    def test_parses_release_and_utilization_from_the_funding_table(self) -> None:
        funds, _coverage, errors, _columns = parse_jjm_dashboard(
            fixture("jal_jeevan_dashboard.html"), as_of=AS_OF
        )
        assert errors == []
        stages = {row["stage"] for row in funds}
        assert stages == {"RELEASE", "UTILIZATION"}

    def test_reads_the_crore_unit_from_the_column_header(self) -> None:
        funds, _, _, _ = parse_jjm_dashboard(fixture("jal_jeevan_dashboard.html"), as_of=AS_OF)
        release = next(row for row in funds if row["stage"] == "RELEASE")
        expenditure = next(row for row in funds if row["stage"] == "UTILIZATION")
        assert release["amount_inr_cr"] == Decimal("45120.75")
        assert expenditure["amount_inr_cr"] == Decimal("78340.55")

    def test_state_share_and_ratios_are_not_mistaken_for_a_stage(self) -> None:
        funds, _, _, _ = parse_jjm_dashboard(fixture("jal_jeevan_dashboard.html"), as_of=AS_OF)
        labels = {row["label_raw"] for row in funds}
        assert "State Share Release" not in labels
        assert "Percentage Expenditure" not in labels

    def test_tap_coverage_is_a_count_never_a_money_amount(self) -> None:
        funds, coverage, _, _ = parse_jjm_dashboard(
            fixture("jal_jeevan_dashboard.html"), as_of=AS_OF
        )
        assert len(coverage) == 1
        assert coverage[0]["count"] == 152344120
        assert all(row["amount_inr_cr"] != Decimal(152344120) for row in funds)

    def test_rows_satisfy_the_schema(self) -> None:
        funds, _, _, _ = parse_jjm_dashboard(fixture("jal_jeevan_dashboard.html"), as_of=AS_OF)
        assert len(validate_rows(funds, JjmFundingRow, source_id="jjm")) == 2

    def test_facts_are_distinct_stages_for_the_mission(self) -> None:
        funds, _, _, _ = parse_jjm_dashboard(fixture("jal_jeevan_dashboard.html"), as_of=AS_OF)
        validated = validate_rows(funds, JjmFundingRow, source_id="jjm")
        facts = jjm_to_facts(validated)
        by_stage = {fact.stage: fact for fact in facts}
        assert set(by_stage) == {"RELEASE", "UTILIZATION"}
        assert all(fact.entity_id == JJM_SCHEME_ID for fact in facts)
        assert all(fact.stage != "EXPENDITURE" for fact in facts)

    def test_a_moved_page_yields_no_rows_and_aborts_on_drift(self) -> None:
        funds, _, _, _ = parse_jjm_dashboard(
            "<html><body><p>Under maintenance</p></body></html>", as_of=AS_OF
        )
        assert funds == []
        findings = sanity_check(RunMetrics(row_count=0), [RunMetrics(row_count=2)])
        assert should_abort(findings)
