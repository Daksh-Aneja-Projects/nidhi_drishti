"""Source parser tests against realistic fixtures. No network, no database.

Each source is exercised three ways:

* the happy path, against markup shaped like the real page;
* the unit-missing path, which must produce parse errors rather than numbers;
* the moved-or-restructured path, which must produce zero rows so the drift
  check turns it into a high-severity finding instead of a crash.
"""

from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from pipelines.lib.drift import RunMetrics, sanity_check, should_abort
from pipelines.lib.validation import validate_rows
from pipelines.parsers.inr_amounts import CRORE
from pipelines.sources.cga_monthly.pipeline import CgaExpenditureRow, parse_expenditure_table
from pipelines.sources.cga_monthly.pipeline import to_facts as cga_to_facts
from pipelines.sources.cppp_tenders.pipeline import (
    CpppTenderRow,
    match_organisation,
    parse_tender_listing,
    to_tenders,
)
from pipelines.sources.obi_historical.pipeline import (
    ObiBudgetRow,
    compare_with_canonical,
    parse_budget_csv,
)
from pipelines.sources.ogd_datasets.pipeline import (
    DATASETS,
    OgdRecordRow,
    parse_resource_payload,
)
from pipelines.sources.pfms_published.pipeline import (
    PfmsReleaseRow,
    parse_scheme_releases,
)
from pipelines.sources.pfms_published.pipeline import to_facts as pfms_to_facts
from pipelines.sources.pib_releases.pipeline import PibReleaseRow, parse_release_listing

FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# CGA Monthly Accounts
# ---------------------------------------------------------------------------


class TestCgaMonthly:
    def test_parses_the_ministry_expenditure_statement(self) -> None:
        rows, errors, columns = parse_expenditure_table(fixture("cga_monthly_accounts.html"))
        assert errors == []
        labels = [row["ministry_raw"] for row in rows]
        assert "Ministry of Defence" in labels
        assert "Ministry / Department" in columns[0]

    def test_reads_the_unit_from_the_caption_not_from_a_guess(self) -> None:
        rows, _, _ = parse_expenditure_table(fixture("cga_monthly_accounts.html"))
        defence = next(row for row in rows if row["ministry_raw"] == "Ministry of Defence")
        assert defence["expenditure_inr_cr"] == Decimal("412540.36")

    def test_the_period_is_read_and_flagged_cumulative(self) -> None:
        """April-November is eight months of spending, and the flag says so."""
        rows, _, _ = parse_expenditure_table(fixture("cga_monthly_accounts.html"))
        row = rows[0]
        assert row["fy"] == "FY2026"
        assert row["period_start"] == date(2025, 4, 1)
        assert row["period_end"] == date(2025, 11, 30)
        assert row["is_cumulative"] is True

    def test_the_grand_total_row_is_excluded(self) -> None:
        rows, _, _ = parse_expenditure_table(fixture("cga_monthly_accounts.html"))
        assert all("total" not in row["ministry_raw"].lower() for row in rows)

    def test_an_unreported_cell_is_skipped_not_written_as_zero(self) -> None:
        rows, _, _ = parse_expenditure_table(fixture("cga_monthly_accounts.html"))
        assert all(row["ministry_raw"] != "Ministry of Ayush" for row in rows)

    def test_without_a_stated_unit_every_row_becomes_a_parse_error(self) -> None:
        rows, errors, _ = parse_expenditure_table(
            fixture("cga_monthly_accounts_no_unit.html")
        )
        assert rows == []
        assert len(errors) == 2
        assert all("no unit" in error["reason"] for error in errors)

    def test_rows_satisfy_the_schema(self) -> None:
        rows, _, _ = parse_expenditure_table(fixture("cga_monthly_accounts.html"))
        validated = validate_rows(rows, CgaExpenditureRow, source_id="cga_monthly")
        assert len(validated) == len(rows)

    def test_a_moved_page_yields_no_rows_and_aborts_on_drift(self) -> None:
        """A 200 response with the wrong content must not write anything."""
        rows, _, _ = parse_expenditure_table("<html><body><h1>Page not found</h1></body></html>")
        assert rows == []
        findings = sanity_check(RunMetrics(row_count=0), [RunMetrics(row_count=40)])
        assert should_abort(findings)

    def test_facts_are_expenditure_provisional_and_cumulative(self) -> None:
        rows, _, _ = parse_expenditure_table(fixture("cga_monthly_accounts.html"))
        validated = validate_rows(rows, CgaExpenditureRow, source_id="cga_monthly")
        facts, unresolved = cga_to_facts(
            validated, resolve_ministry={"ministry of defence": "min-defence"}
        )
        assert len(facts) == 1
        assert len(unresolved) == len(validated) - 1
        fact = facts[0]
        assert fact.stage == "EXPENDITURE"
        assert fact.is_cumulative is True
        assert fact.is_provisional is True
        assert fact.entity_id == "min-defence"

    def test_an_unresolved_ministry_is_queued_never_guessed(self) -> None:
        rows, _, _ = parse_expenditure_table(fixture("cga_monthly_accounts.html"))
        validated = validate_rows(rows, CgaExpenditureRow, source_id="cga_monthly")
        facts, unresolved = cga_to_facts(validated, resolve_ministry={})
        assert facts == []
        assert len(unresolved) == len(validated)


# ---------------------------------------------------------------------------
# CPPP tenders
# ---------------------------------------------------------------------------


class TestCpppTenders:
    def test_parses_the_public_listing(self) -> None:
        rows, errors, columns = parse_tender_listing(fixture("cppp_tender_listing.html"))
        assert errors == []
        assert len(rows) == 4
        assert "Organisation Name" in columns

    def test_values_are_read_as_rupees_and_converted_to_crore(self) -> None:
        """CPPP publishes in rupees. 45,00,00,000 is 45 crore, not 45 crore crore."""
        rows, _, _ = parse_tender_listing(fixture("cppp_tender_listing.html"))
        defence = next(row for row in rows if row["tender_id"] == "MOD/ARMY/2025/0417")
        assert defence["value_inr_cr"] == Decimal("45")

    def test_a_tender_without_a_value_is_kept(self) -> None:
        rows, _, _ = parse_tender_listing(fixture("cppp_tender_listing.html"))
        railway = next(row for row in rows if row["tender_id"] == "RLY/NR/2025/1201")
        assert railway["value_inr_cr"] is None
        assert railway["title"]

    def test_dates_and_links_are_captured(self) -> None:
        rows, _, _ = parse_tender_listing(fixture("cppp_tender_listing.html"))
        assert rows[0]["published_date"] == date(2025, 11, 21)
        assert rows[0]["url"] is not None

    def test_rows_satisfy_the_schema(self) -> None:
        rows, _, _ = parse_tender_listing(fixture("cppp_tender_listing.html"))
        assert len(validate_rows(rows, CpppTenderRow, source_id="cppp")) == 4

    def test_an_exact_organisation_match_is_high_confidence(self) -> None:
        ministries = {"ministry of railways": "min-railways"}
        assert match_organisation("ministry of railways", ministries) == (
            "min-railways",
            "high",
        )

    def test_an_unmatched_organisation_stays_unattached(self) -> None:
        """Attaching a tender to the wrong ministry is a false claim."""
        assert match_organisation("some state water board", {"ministry of coal": "min-coal"}) == (
            None,
            None,
        )

    def test_unattached_tenders_are_still_stored(self) -> None:
        rows, _, _ = parse_tender_listing(fixture("cppp_tender_listing.html"))
        validated = validate_rows(rows, CpppTenderRow, source_id="cppp")
        tenders = to_tenders(validated, ministries={})
        assert len(tenders) == 4
        assert all(tender.ministry_id is None for tender in tenders)
        assert all(tender.status == "published" for tender in tenders)

    def test_a_restructured_listing_yields_nothing(self) -> None:
        rows, _, _ = parse_tender_listing("<html><body><p>Site under maintenance</p></body></html>")
        assert rows == []


# ---------------------------------------------------------------------------
# PIB releases
# ---------------------------------------------------------------------------


class TestPibReleases:
    def test_parses_the_daily_listing(self) -> None:
        rows, errors, _ = parse_release_listing(
            fixture("pib_release_listing.html"), listing_date=date(2025, 11, 21)
        )
        assert errors == []
        assert len(rows) == 4

    def test_releases_are_tagged_with_the_ministry_heading_above_them(self) -> None:
        rows, _, _ = parse_release_listing(
            fixture("pib_release_listing.html"), listing_date=date(2025, 11, 21)
        )
        by_prid = {row["prid"]: row for row in rows}
        assert by_prid["2081234"]["ministry_raw"] == "Ministry of Jal Shakti"
        assert by_prid["2081251"]["ministry_raw"] == "Ministry of Defence"

    def test_amount_mentions_are_kept_as_quotable_text_not_parsed(self) -> None:
        """A press release figure is evidence of an announcement, not a fiscal fact."""
        rows, _, _ = parse_release_listing(fixture("pib_release_listing.html"))
        namami = next(row for row in rows if row["prid"] == "2081235")
        assert namami["amount_mentions"] == ("Rs. 2,500 crore",)
        assert not isinstance(namami["amount_mentions"][0], Decimal)

    def test_rows_satisfy_the_schema(self) -> None:
        rows, _, _ = parse_release_listing(fixture("pib_release_listing.html"))
        assert len(validate_rows(rows, PibReleaseRow, source_id="pib")) == 4

    def test_a_moved_listing_reports_a_parse_error(self) -> None:
        rows, errors, _ = parse_release_listing("<html><body>Not found</body></html>")
        assert rows == []
        assert errors and "moved" in errors[0]["reason"]


# ---------------------------------------------------------------------------
# PFMS published dashboard
# ---------------------------------------------------------------------------


class TestPfmsPublished:
    def test_parses_the_scheme_release_table(self) -> None:
        rows, errors, columns = parse_scheme_releases(
            fixture("pfms_scheme_releases.html"), as_published_on=date(2025, 11, 21)
        )
        assert errors == []
        assert len(rows) == 4
        assert "Scheme Name" in columns

    def test_releases_are_cumulative_and_dated_to_the_snapshot(self) -> None:
        rows, _, _ = parse_scheme_releases(
            fixture("pfms_scheme_releases.html"), as_published_on=date(2025, 11, 21)
        )
        kisan = next(row for row in rows if "Kisan" in row["scheme_raw"])
        assert kisan["released_inr_cr"] == Decimal("48250.00")
        assert kisan["is_cumulative"] is True
        assert kisan["as_published_on"] == date(2025, 11, 21)
        assert kisan["fy"] == "FY2026"

    def test_the_total_row_is_excluded(self) -> None:
        rows, _, _ = parse_scheme_releases(
            fixture("pfms_scheme_releases.html"), as_published_on=date(2025, 11, 21)
        )
        assert all(not row["scheme_raw"].lower().startswith("total") for row in rows)

    def test_facts_carry_the_snapshot_date_as_the_period_end(self) -> None:
        rows, _, _ = parse_scheme_releases(
            fixture("pfms_scheme_releases.html"), as_published_on=date(2025, 11, 21)
        )
        validated = validate_rows(rows, PfmsReleaseRow, source_id="pfms_pub")
        facts, _ = pfms_to_facts(
            validated,
            resolve_scheme={"pradhan mantri kisan samman nidhi": "sch-pm-kisan"},
        )
        assert len(facts) == 1
        assert facts[0].stage == "RELEASE"
        assert facts[0].period_end == date(2025, 11, 21)
        assert facts[0].is_cumulative is True

    def test_two_snapshots_are_never_summed(self) -> None:
        """Both snapshots are the same running total viewed at two dates."""
        november, _, _ = parse_scheme_releases(
            fixture("pfms_scheme_releases.html"), as_published_on=date(2025, 11, 21)
        )
        december, _, _ = parse_scheme_releases(
            fixture("pfms_scheme_releases.html"), as_published_on=date(2025, 12, 21)
        )
        first = validate_rows(november, PfmsReleaseRow, source_id="pfms_pub")
        second = validate_rows(december, PfmsReleaseRow, source_id="pfms_pub")
        assert all(row.is_cumulative for row in [*first, *second])
        assert first[0].released_inr_cr == second[0].released_inr_cr


# ---------------------------------------------------------------------------
# Open Budgets India
# ---------------------------------------------------------------------------


class TestObiHistorical:
    def test_parses_be_and_re_from_the_csv(self) -> None:
        rows, errors, columns = parse_budget_csv(
            fixture("obi_union_budget.csv"), unit_hint=CRORE
        )
        assert errors == []
        assert "budget_estimates" in columns
        be_rows = [row for row in rows if row["stage"] == "BE"]
        re_rows = [row for row in rows if row["stage"] == "RE"]
        assert len(be_rows) == 5
        # Ayush has no RE figure, so it produces no RE row rather than a zero.
        assert len(re_rows) == 4

    def test_the_indian_fiscal_year_label_is_converted(self) -> None:
        rows, _, _ = parse_budget_csv(fixture("obi_union_budget.csv"), unit_hint=CRORE)
        assert {row["fy"] for row in rows} == {"FY2026"}

    def test_without_a_unit_nothing_is_parsed(self) -> None:
        rows, errors, _ = parse_budget_csv(fixture("obi_union_budget.csv"))
        assert rows == []
        assert len(errors) == 9

    def test_rows_satisfy_the_schema(self) -> None:
        rows, _, _ = parse_budget_csv(fixture("obi_union_budget.csv"), unit_hint=CRORE)
        assert validate_rows(rows, ObiBudgetRow, source_id="obi")

    def test_a_restructured_csv_reports_drift_rather_than_parsing_nonsense(self) -> None:
        rows, errors, _ = parse_budget_csv("col_a,col_b\n1,2\n", unit_hint=CRORE)
        assert rows == []
        assert "restructured" in errors[0]["reason"]

    def test_cross_check_reports_material_disagreement(self) -> None:
        """The reason to ingest OBI at all: catching our own parsing errors."""
        rows, _, _ = parse_budget_csv(fixture("obi_union_budget.csv"), unit_hint=CRORE)
        validated = validate_rows(rows, ObiBudgetRow, source_id="obi")
        canonical = {
            ("ministry of defence", "FY2026", "BE"): Decimal("621940.85"),
            ("ministry of railways", "FY2026", "BE"): Decimal("25544.50"),
        }
        discrepancies = compare_with_canonical(validated, canonical)
        assert len(discrepancies) == 1
        assert discrepancies[0]["entity"] == "Ministry of Railways"


# ---------------------------------------------------------------------------
# data.gov.in
# ---------------------------------------------------------------------------


class TestOgdDatasets:
    def _payload(self) -> str:
        return json.dumps(
            {
                "updated_date": "2025-11-20",
                "field": [
                    {"id": "ministry", "name": "Ministry"},
                    {"id": "financial_year", "name": "Financial Year"},
                    {"id": "expenditure", "name": "Expenditure"},
                ],
                "records": [
                    {
                        "ministry": "Ministry of Defence",
                        "financial_year": "2025-26",
                        "expenditure": "412540.36",
                    },
                    {
                        "ministry": "Ministry of Railways",
                        "financial_year": "2025-26",
                        "expenditure": "168220.00",
                    },
                ],
            }
        )

    def test_parses_the_api_envelope(self) -> None:
        spec = DATASETS["ministry_wise_expenditure"]
        rows, errors, fields = parse_resource_payload(
            self._payload(), spec, dataset_name="ministry_wise_expenditure"
        )
        assert errors == []
        assert fields == ["ministry", "financial_year", "expenditure"]
        assert rows[0]["amount_inr_cr"] == Decimal("412540.36")
        assert rows[0]["fy"] == "FY2026"

    def test_the_declared_unit_is_applied(self) -> None:
        """A bare number from an API is as ambiguous as one from a PDF."""
        spec = DATASETS["scheme_wise_allocation"]
        payload = json.dumps(
            {
                "field": [{"id": "scheme_name"}, {"id": "budget_estimate"}],
                "records": [
                    {
                        "scheme_name": "PM-KISAN",
                        "budget_estimate": "6350000",
                        "financial_year": "2025-26",
                    }
                ],
            }
        )
        rows, _, _ = parse_resource_payload(payload, spec, dataset_name="scheme_wise_allocation")
        # Declared in lakh, so 63,50,000 lakh is 63,500 crore.
        assert rows[0]["amount_inr_cr"] == Decimal("63500")

    def test_a_record_without_a_fiscal_year_is_queued(self) -> None:
        spec = DATASETS["ministry_wise_expenditure"]
        payload = json.dumps(
            {
                "field": [{"id": "ministry"}, {"id": "expenditure"}],
                "records": [{"ministry": "Ministry of Coal", "expenditure": "100"}],
            }
        )
        rows, errors, _ = parse_resource_payload(
            payload, spec, dataset_name="ministry_wise_expenditure"
        )
        assert rows == []
        assert "fiscal year" in errors[0]["reason"]

    def test_rows_satisfy_the_schema(self) -> None:
        spec = DATASETS["ministry_wise_expenditure"]
        rows, _, _ = parse_resource_payload(
            self._payload(), spec, dataset_name="ministry_wise_expenditure"
        )
        assert len(validate_rows(rows, OgdRecordRow, source_id="ogd")) == 2

    def test_a_non_json_response_raises_clearly(self) -> None:
        spec = DATASETS["ministry_wise_expenditure"]
        with pytest.raises(ValueError, match="did not return JSON"):
            parse_resource_payload("<html>rate limited</html>", spec, dataset_name="x")

    def test_every_registered_dataset_declares_a_unit(self) -> None:
        assert all(spec.unit is not None for spec in DATASETS.values())
