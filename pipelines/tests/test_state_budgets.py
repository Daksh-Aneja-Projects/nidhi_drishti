"""State budget source tests (docs/12). No network, no database.

Each of the two state sources is exercised the three ways every source is:

* the happy path, against markup shaped like a real Budget at a Glance;
* the unit-missing path, which must produce parse errors rather than numbers;
* the moved-or-restructured path, which must produce zero rows so the drift
  check turns it into a high-severity finding instead of a crash.

Plus the checks that only matter for a state source: that spending is written
under entity_type = 'state' and never under a Union entity, and that the
completed year's Accounts column becomes a full-year EXPENDITURE fact.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import pytest

from pipelines.lib.config import Settings
from pipelines.lib.drift import RunMetrics, sanity_check, should_abort
from pipelines.lib.runs import PipelineAborted
from pipelines.lib.storage import ArtifactRef, sha256_hex
from pipelines.lib.validation import validate_rows
from pipelines.sources.state_karnataka.pipeline import (
    STATE_ID as KA_STATE_ID,
)
from pipelines.sources.state_karnataka.pipeline import (
    KarnatakaBudgetRow,
    parse_budget_glance,
)
from pipelines.sources.state_karnataka.pipeline import (
    to_facts as ka_to_facts,
)
from pipelines.sources.state_odisha.pipeline import (
    STATE_ID as OD_STATE_ID,
)
from pipelines.sources.state_odisha.pipeline import (
    OdishaBudgetRow,
)
from pipelines.sources.state_odisha.pipeline import (
    parse_budget_glance as parse_odisha_glance,
)
from pipelines.sources.state_odisha.pipeline import (
    to_facts as od_to_facts,
)
from pipelines.tests.conftest import RecordingSleeper, make_client

FIXTURES = Path(__file__).parent / "fixtures"
ROBOTS = "User-agent: *\nAllow: /\n"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


@pytest.fixture
def fake_store_raw(monkeypatch: pytest.MonkeyPatch) -> list[ArtifactRef]:
    """Replace object storage with an in-memory recorder (as test_runs does)."""
    stored: list[ArtifactRef] = []
    seen: set[str] = set()

    def _store(
        source_id: str,
        url: str | None,
        content: bytes,
        content_type: str,
        **kwargs: Any,
    ) -> ArtifactRef:
        digest = sha256_hex(content)
        ref = ArtifactRef(
            source_id=source_id,
            key=f"raw/{source_id}/2025/11/{digest}.html",
            sha256=digest,
            byte_size=len(content),
            content_type=content_type,
            url=url,
            stored_at=datetime.now(UTC),
            already_present=digest in seen,
        )
        seen.add(digest)
        stored.append(ref)
        return ref

    monkeypatch.setattr("pipelines.lib.ingest.store_raw", _store)
    return stored


def serve(path: str) -> Any:
    body = (FIXTURES / path).read_bytes()

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text=ROBOTS)
        return httpx.Response(200, content=body, headers={"content-type": "text/html"})

    return handle


# ---------------------------------------------------------------------------
# Karnataka
# ---------------------------------------------------------------------------


class TestKarnataka:
    def test_parses_the_expenditure_rows_of_the_glance(self) -> None:
        rows, errors, columns = parse_budget_glance(fixture("state_karnataka_budget_glance.html"))
        assert errors == []
        # Three expenditure rows across three year columns.
        assert len(rows) == 9
        assert "Item" in columns[0]
        heads = {row["head"] for row in rows}
        assert heads == {"revenue", "capital", "total"}

    def test_reads_the_unit_from_the_caption_not_a_guess(self) -> None:
        rows, _, _ = parse_budget_glance(fixture("state_karnataka_budget_glance.html"))
        be_total = next(row for row in rows if row["stage"] == "BE" and row["head"] == "total")
        assert be_total["amount_inr_cr"] == Decimal("339000.50")
        assert be_total["fy"] == "FY2026"

    def test_the_columns_map_to_the_right_stage_and_year(self) -> None:
        rows, _, _ = parse_budget_glance(fixture("state_karnataka_budget_glance.html"))
        by_key = {(row["stage"], row["head"]): row for row in rows}
        # Budget Estimate column of 2025-26.
        assert by_key[("BE", "revenue")]["fy"] == "FY2026"
        # Revised Estimate column of 2024-25.
        assert by_key[("RE", "total")]["fy"] == "FY2025"
        # The Accounts column of 2023-24 is a completed-year actual.
        assert by_key[("EXPENDITURE", "capital")]["fy"] == "FY2024"

    def test_receipts_and_deficit_rows_are_excluded(self) -> None:
        rows, _, _ = parse_budget_glance(fixture("state_karnataka_budget_glance.html"))
        labels = {row["item_raw"].lower() for row in rows}
        assert not any("receipts" in label for label in labels)
        assert not any("deficit" in label for label in labels)

    def test_without_a_stated_unit_every_cell_becomes_a_parse_error(self) -> None:
        rows, errors, _ = parse_budget_glance(fixture("state_karnataka_budget_glance_no_unit.html"))
        assert rows == []
        # Two expenditure rows across two year columns, all ambiguous.
        assert len(errors) == 4
        assert all("no unit" in error["reason"] for error in errors)

    def test_rows_satisfy_the_schema(self) -> None:
        rows, _, _ = parse_budget_glance(fixture("state_karnataka_budget_glance.html"))
        validated = validate_rows(rows, KarnatakaBudgetRow, source_id="state_karnataka")
        assert len(validated) == len(rows)

    def test_facts_are_written_under_the_state_entity_never_a_union_one(self) -> None:
        rows, _, _ = parse_budget_glance(fixture("state_karnataka_budget_glance.html"))
        validated = validate_rows(rows, KarnatakaBudgetRow, source_id="state_karnataka")
        facts = ka_to_facts(validated)
        assert facts
        # The whole point of the CSS rule: state spending stays in the state
        # ledger, so it is never summed into the Union scheme or ministry totals.
        assert all(fact.entity_type == "state" for fact in facts)
        assert all(fact.entity_id == KA_STATE_ID for fact in facts)

    def test_the_accounts_column_becomes_a_full_year_expenditure_fact(self) -> None:
        rows, _, _ = parse_budget_glance(fixture("state_karnataka_budget_glance.html"))
        validated = validate_rows(rows, KarnatakaBudgetRow, source_id="state_karnataka")
        facts = ka_to_facts(validated)
        actual = next(
            fact for fact in facts if fact.stage == "EXPENDITURE" and fact.head == "total"
        )
        assert actual.period_start == date(2023, 4, 1)
        assert actual.period_end == date(2024, 3, 31)
        assert actual.is_cumulative is True
        assert actual.amount_inr_cr == Decimal("280000.00")

    def test_authority_facts_carry_no_period(self) -> None:
        rows, _, _ = parse_budget_glance(fixture("state_karnataka_budget_glance.html"))
        validated = validate_rows(rows, KarnatakaBudgetRow, source_id="state_karnataka")
        facts = ka_to_facts(validated)
        for fact in facts:
            if fact.stage in {"BE", "RE"}:
                assert fact.period_start is None
                assert fact.period_end is None

    def test_a_moved_page_yields_no_rows_and_aborts_on_drift(self) -> None:
        rows, _, _ = parse_budget_glance("<html><body><h1>Page not found</h1></body></html>")
        assert rows == []
        findings = sanity_check(RunMetrics(row_count=0), [RunMetrics(row_count=9)])
        assert should_abort(findings)

    def test_dry_run_end_to_end(
        self, settings: Settings, fake_store_raw: list[ArtifactRef]
    ) -> None:
        from pipelines.sources.state_karnataka.pipeline import URLS, run

        client = make_client(
            settings, serve("state_karnataka_budget_glance.html"), RecordingSleeper()
        )
        outcome = run(client=client, dry_run=True, url=URLS["budget_at_a_glance"])
        assert outcome.source_id == "state_karnataka"
        assert outcome.rows_parsed == 9
        assert outcome.facts_written == 0
        assert outcome.status == "ok"
        assert outcome.artifacts and outcome.artifacts[0].startswith("raw/state_karnataka/")

    def test_dry_run_aborts_when_the_page_is_restructured(
        self, settings: Settings, fake_store_raw: list[ArtifactRef]
    ) -> None:
        from pipelines.sources.state_karnataka.pipeline import URLS, run

        def handle(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/robots.txt":
                return httpx.Response(200, text=ROBOTS)
            return httpx.Response(
                200,
                content=b"<html><body><p>Site under maintenance</p></body></html>",
                headers={"content-type": "text/html"},
            )

        client = make_client(settings, handle, RecordingSleeper())
        with pytest.raises(PipelineAborted):
            run(client=client, dry_run=True, url=URLS["budget_at_a_glance"])


# ---------------------------------------------------------------------------
# Odisha
# ---------------------------------------------------------------------------


class TestOdisha:
    def test_parses_the_expenditure_rows(self) -> None:
        rows, errors, columns = parse_odisha_glance(fixture("state_odisha_budget_glance.html"))
        assert errors == []
        assert len(rows) == 9
        assert "Particulars" in columns[0]

    def test_the_provisional_actuals_column_flags_the_fact(self) -> None:
        rows, _, _ = parse_odisha_glance(fixture("state_odisha_budget_glance.html"))
        actual = next(
            row for row in rows if row["stage"] == "EXPENDITURE" and row["head"] == "total"
        )
        assert actual["fy"] == "FY2024"
        assert actual["is_provisional"] is True
        validated = validate_rows(rows, OdishaBudgetRow, source_id="state_odisha")
        facts = od_to_facts(validated)
        actual_fact = next(
            fact for fact in facts if fact.stage == "EXPENDITURE" and fact.head == "total"
        )
        assert actual_fact.is_provisional is True
        assert actual_fact.entity_id == OD_STATE_ID

    def test_the_programme_split_is_not_read_as_an_expenditure_head(self) -> None:
        """Programme and administrative splits are a documented gap, not a guess."""
        rows, _, _ = parse_odisha_glance(fixture("state_odisha_budget_glance.html"))
        assert not any("programme" in row["item_raw"].lower() for row in rows)

    def test_the_budget_estimate_total_is_read(self) -> None:
        rows, _, _ = parse_odisha_glance(fixture("state_odisha_budget_glance.html"))
        be_total = next(row for row in rows if row["stage"] == "BE" and row["head"] == "total")
        assert be_total["amount_inr_cr"] == Decimal("205000.00")
        assert be_total["fy"] == "FY2026"

    def test_rows_satisfy_the_schema(self) -> None:
        rows, _, _ = parse_odisha_glance(fixture("state_odisha_budget_glance.html"))
        assert len(validate_rows(rows, OdishaBudgetRow, source_id="state_odisha")) == len(rows)

    def test_facts_are_written_under_the_state_entity(self) -> None:
        rows, _, _ = parse_odisha_glance(fixture("state_odisha_budget_glance.html"))
        facts = od_to_facts(validate_rows(rows, OdishaBudgetRow, source_id="state_odisha"))
        assert all(fact.entity_type == "state" and fact.entity_id == OD_STATE_ID for fact in facts)

    def test_a_restructured_page_yields_nothing(self) -> None:
        rows, _, _ = parse_odisha_glance("<html><body><p>Not found</p></body></html>")
        assert rows == []

    def test_dry_run_end_to_end(
        self, settings: Settings, fake_store_raw: list[ArtifactRef]
    ) -> None:
        from pipelines.sources.state_odisha.pipeline import URLS, run

        client = make_client(settings, serve("state_odisha_budget_glance.html"), RecordingSleeper())
        outcome = run(client=client, dry_run=True, url=URLS["budget_at_a_glance"])
        assert outcome.source_id == "state_odisha"
        assert outcome.rows_parsed == 9
        assert outcome.status == "ok"
