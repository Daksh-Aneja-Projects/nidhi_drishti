"""Schema validation tests. Required by CLAUDE.md ("scraper schema validation").

The behaviour under test is a refusal: rows that do not match the schema must
abort the write and carry their evidence out with them, never be dropped.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from pipelines.lib.models import FiscalFactRow
from pipelines.lib.validation import SchemaDriftError, validate_rows


class SampleRow(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    ministry: str = Field(min_length=2)
    amount_inr_cr: Decimal


class TestValidateRows:
    def test_valid_rows_pass_through(self) -> None:
        rows = [
            {"ministry": "Ministry of Defence", "amount_inr_cr": Decimal("621940.85")},
            {"ministry": "Ministry of Railways", "amount_inr_cr": Decimal("255445.00")},
        ]
        validated = validate_rows(rows, SampleRow, source_id="test")
        assert len(validated) == 2
        assert validated[0].amount_inr_cr == Decimal("621940.85")

    def test_one_bad_row_aborts_the_whole_batch(self) -> None:
        """Never partial. A half-written month is harder to spot than a missing one."""
        rows = [
            {"ministry": "Ministry of Defence", "amount_inr_cr": Decimal("1")},
            {"ministry": "X", "amount_inr_cr": Decimal("2")},
        ]
        with pytest.raises(SchemaDriftError):
            validate_rows(rows, SampleRow, source_id="test")

    def test_the_error_carries_every_failure_not_just_the_first(self) -> None:
        """412 of 415 failing is a different diagnosis from 1 of 415 failing."""
        rows = [{"ministry": "X", "amount_inr_cr": Decimal(i)} for i in range(10)]
        with pytest.raises(SchemaDriftError) as caught:
            validate_rows(rows, SampleRow, source_id="cga_monthly")
        error = caught.value
        assert error.failure_count == 10
        assert error.total_rows == 10
        assert error.failure_rate == 1.0

    def test_the_error_keeps_the_offending_rows(self) -> None:
        rows = [{"ministry": "Ministry of Defence", "amount_inr_cr": "not a number"}]
        with pytest.raises(SchemaDriftError) as caught:
            validate_rows(rows, SampleRow, source_id="test")
        sample = caught.value.sample()
        assert sample[0]["row"]["amount_inr_cr"] == "not a number"
        assert "amount_inr_cr" in sample[0]["error"]

    def test_an_extra_column_is_drift(self) -> None:
        """extra='forbid' is the tripwire: a new column means the source changed."""
        rows = [
            {
                "ministry": "Ministry of Defence",
                "amount_inr_cr": Decimal("1"),
                "new_column": "surprise",
            }
        ]
        with pytest.raises(SchemaDriftError):
            validate_rows(rows, SampleRow, source_id="test")

    def test_empty_input_is_drift_by_default(self) -> None:
        with pytest.raises(SchemaDriftError):
            validate_rows([], SampleRow, source_id="test")

    def test_empty_input_can_be_allowed_where_it_is_legitimate(self) -> None:
        assert validate_rows([], SampleRow, source_id="test", allow_empty=True) == []

    def test_alert_body_mentions_the_source_and_the_count(self) -> None:
        rows = [{"ministry": "X", "amount_inr_cr": Decimal("1")}]
        with pytest.raises(SchemaDriftError) as caught:
            validate_rows(rows, SampleRow, source_id="cppp")
        body = caught.value.alert_body()
        assert "cppp" in body
        assert "1 of 1" in body


class TestFiscalFactRowConstraints:
    """The model mirrors the CHECK constraints in db/migrations/0003."""

    def test_a_valid_annual_fact(self) -> None:
        row = FiscalFactRow(
            fy="FY2026",
            entity_type="ministry",
            entity_id="min-defence",
            stage="BE",
            amount_inr_cr=Decimal("621940.85"),
            extraction_method="pdf_table",
        )
        assert row.period_start is None

    def test_an_annual_stage_may_not_carry_a_period(self) -> None:
        with pytest.raises(ValidationError):
            FiscalFactRow(
                fy="FY2026",
                entity_type="ministry",
                entity_id="min-defence",
                stage="BE",
                period_end=date(2026, 3, 31),
                amount_inr_cr=Decimal("1"),
                extraction_method="pdf_table",
            )

    def test_a_flow_stage_must_carry_a_period(self) -> None:
        with pytest.raises(ValidationError):
            FiscalFactRow(
                fy="FY2026",
                entity_type="ministry",
                entity_id="min-defence",
                stage="EXPENDITURE",
                amount_inr_cr=Decimal("1"),
                extraction_method="html_table",
            )

    def test_a_cumulative_fact_must_say_what_it_accumulates_to(self) -> None:
        with pytest.raises(ValidationError):
            FiscalFactRow(
                fy="FY2026",
                entity_type="ministry",
                entity_id="min-defence",
                stage="EXPENDITURE",
                is_cumulative=True,
                amount_inr_cr=Decimal("1"),
                extraction_method="html_table",
            )

    def test_reversed_period_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            FiscalFactRow(
                fy="FY2026",
                entity_type="ministry",
                entity_id="min-defence",
                stage="EXPENDITURE",
                period_start=date(2025, 11, 30),
                period_end=date(2025, 4, 1),
                amount_inr_cr=Decimal("1"),
                extraction_method="html_table",
            )

    def test_an_unknown_stage_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            FiscalFactRow(
                fy="FY2026",
                entity_type="ministry",
                entity_id="min-defence",
                stage="SPENT",
                amount_inr_cr=Decimal("1"),
                extraction_method="pdf_table",
            )

    def test_a_malformed_fy_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            FiscalFactRow(
                fy="2025-26",
                entity_type="ministry",
                entity_id="min-defence",
                stage="BE",
                amount_inr_cr=Decimal("1"),
                extraction_method="pdf_table",
            )

    def test_an_unknown_extraction_method_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            FiscalFactRow(
                fy="FY2026",
                entity_type="ministry",
                entity_id="min-defence",
                stage="BE",
                amount_inr_cr=Decimal("1"),
                extraction_method="vibes",
            )

    def test_a_valid_cumulative_expenditure_fact(self) -> None:
        row = FiscalFactRow(
            fy="FY2026",
            entity_type="ministry",
            entity_id="min-defence",
            stage="EXPENDITURE",
            period_start=date(2025, 4, 1),
            period_end=date(2025, 11, 30),
            is_cumulative=True,
            amount_inr_cr=Decimal("400123.45"),
            extraction_method="html_table",
            is_provisional=True,
        )
        assert row.is_provisional is True
