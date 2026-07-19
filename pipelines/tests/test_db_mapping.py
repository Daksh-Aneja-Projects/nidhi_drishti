"""Database mapping tests that need no database.

The SQL itself is exercised by the migrations' own tests. What is checked here
is the Python side of the contract: money is quantised exactly once, on the way
in, and the upsert targets the natural key that makes re-running a pipeline over
the same document a no-op.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from pipelines.lib.db import _UPSERT_FACT_SQL, fact_params, quantize_crore
from pipelines.lib.models import FiscalFactRow


class TestQuantisation:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("123456.789", "123456.79"),
            ("123456.781", "123456.78"),
            ("123456.785", "123456.79"),
            ("-1234.565", "-1234.57"),
            ("5065345", "5065345.00"),
        ],
    )
    def test_rounds_to_the_two_places_the_column_holds(self, raw: str, expected: str) -> None:
        assert quantize_crore(Decimal(raw)) == Decimal(expected)

    def test_large_national_totals_survive_exactly(self) -> None:
        """NUMERIC(20,2) exists so this number is not approximated anywhere."""
        total = Decimal("5065345.67")
        assert quantize_crore(total) == total

    def test_quantisation_never_introduces_a_float(self) -> None:
        assert isinstance(quantize_crore(Decimal("1.005")), Decimal)


class TestFactParams:
    def _row(self, **overrides: object) -> FiscalFactRow:
        base = {
            "fy": "FY2026",
            "entity_type": "ministry",
            "entity_id": "min-defence",
            "stage": "EXPENDITURE",
            "head": "total",
            "period_start": date(2025, 4, 1),
            "period_end": date(2025, 11, 30),
            "is_cumulative": True,
            "amount_inr_cr": Decimal("412540.361"),
            "extraction_method": "html_table",
            "is_provisional": True,
        }
        base.update(overrides)
        return FiscalFactRow(**base)

    def test_every_column_the_insert_needs_is_bound(self) -> None:
        params = fact_params(self._row(), source_record_id=42)
        expected = {
            "fy",
            "entity_type",
            "entity_id",
            "stage",
            "head",
            "period_start",
            "period_end",
            "is_cumulative",
            "amount_inr_cr",
            "source_record_id",
            "extraction_method",
            "is_provisional",
        }
        assert set(params) == expected

    def test_the_amount_is_quantised_on_the_way_in(self) -> None:
        params = fact_params(self._row(), source_record_id=1)
        assert params["amount_inr_cr"] == Decimal("412540.36")

    def test_provenance_is_always_attached(self) -> None:
        """No fact without a source_record_id. The column is NOT NULL for a reason."""
        assert fact_params(self._row(), source_record_id=7)["source_record_id"] == 7

    def test_an_annual_fact_binds_null_periods(self) -> None:
        row = self._row(stage="BE", period_start=None, period_end=None, is_cumulative=False)
        params = fact_params(row, source_record_id=1)
        assert params["period_start"] is None
        assert params["period_end"] is None


class TestUpsertSql:
    def test_the_conflict_target_is_the_natural_key(self) -> None:
        """Matches the fiscal_fact_natural_key index in db/migrations/0003."""
        assert (
            "ON CONFLICT (fy, entity_type, entity_id, stage, head, period_start, period_end,"
            in _UPSERT_FACT_SQL
        )
        assert "source_record_id)" in _UPSERT_FACT_SQL

    def test_the_upsert_updates_rather_than_duplicating(self) -> None:
        assert "DO UPDATE SET" in _UPSERT_FACT_SQL
        assert "amount_inr_cr     = EXCLUDED.amount_inr_cr" in _UPSERT_FACT_SQL

    def test_the_upsert_never_rewrites_provenance(self) -> None:
        """A corrected figure from a new document is a new fact, not an edit."""
        update_clause = _UPSERT_FACT_SQL.split("DO UPDATE SET", 1)[1]
        assert "source_record_id" not in update_clause
        assert "supersedes_fact_id" not in update_clause
