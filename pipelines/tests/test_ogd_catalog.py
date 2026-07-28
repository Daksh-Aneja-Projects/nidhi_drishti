"""Catalogue exploration tests.

The tool that finds a data.gov.in resource has one job worth testing: read a
response whose shape the portal keeps changing, and never pretend to have found
an id it did not find. A search that silently drops half its results is worse
than one that fails, because the missing dataset looks like a dataset that does
not exist.
"""

from __future__ import annotations

import json
from dataclasses import replace

import pytest

from pipelines.lib.config import Settings
from pipelines.lib.fetch import public_url
from pipelines.sources.ogd_datasets.catalog import (
    _api_url,
    parse_catalog_payload,
    parse_resource_shape,
)

CATALOG_RESPONSE = json.dumps(
    {
        "records": [
            {
                "index_name": "9ef84268-d588-465a-a308-a864a43d0070",
                "title": "Ministry-wise Expenditure Budget",
                "org": ["Ministry of Finance", "Department of Expenditure"],
                "sector": "Finance",
                "updated_date": "2026-02-05",
            },
            {
                # An older shape: resource_id rather than index_name, desc
                # rather than title.
                "resource_id": "3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69",
                "desc": "Scheme-wise allocation",
                "source": "data.gov.in",
            },
            # No id in any known field: unusable, and dropping it quietly would
            # be the wrong kind of tolerant.
            {"title": "A dataset with no id"},
        ]
    }
)

RESOURCE_RESPONSE = json.dumps(
    {
        "title": "Ministry-wise Expenditure Budget",
        "total": 412,
        "updated_date": "2026-02-05",
        "field": [
            {"id": "ministry", "name": "Ministry"},
            {"id": "financial_year", "name": "Financial Year"},
            {"id": "expenditure", "name": "Expenditure"},
        ],
        "records": [
            {
                "ministry": "Ministry of Rural Development",
                "financial_year": "2025-26",
                "expenditure": "180671.00",
            }
        ],
    }
)


class TestCatalogParsing:
    def test_entries_are_read_from_both_response_shapes(self) -> None:
        entries = parse_catalog_payload(CATALOG_RESPONSE)
        assert [entry.resource_id for entry in entries] == [
            "9ef84268-d588-465a-a308-a864a43d0070",
            "3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69",
        ]
        assert entries[0].title == "Ministry-wise Expenditure Budget"
        assert "Ministry of Finance" in entries[0].organisation
        assert entries[1].title == "Scheme-wise allocation"

    def test_a_record_with_no_id_is_dropped_rather_than_shown_unusable(self) -> None:
        assert len(parse_catalog_payload(CATALOG_RESPONSE)) == 2

    def test_an_empty_catalogue_is_not_an_error(self) -> None:
        assert parse_catalog_payload('{"records": []}') == []


class TestResourceShape:
    def test_field_names_and_samples_are_reported(self) -> None:
        shape = parse_resource_shape(RESOURCE_RESPONSE, "9ef84268")
        assert shape.record_count == 412
        assert [name for name, _ in shape.fields] == [
            "ministry",
            "financial_year",
            "expenditure",
        ]
        assert dict(shape.fields)["ministry"] == "Ministry of Rural Development"

    def test_the_report_insists_on_a_declared_unit(self) -> None:
        # The one thing the API never states and a parser must never guess.
        assert "unit" in parse_resource_shape(RESOURCE_RESPONSE, "x").as_report()

    def test_fields_fall_back_to_the_first_record_when_none_are_declared(self) -> None:
        payload = json.dumps({"records": [{"scheme": "PMAY", "amount": "12"}]})
        shape = parse_resource_shape(payload, "x")
        assert [name for name, _ in shape.fields] == ["amount", "scheme"]

    def test_a_resource_with_no_records_still_reports(self) -> None:
        payload = json.dumps({"title": "Empty", "field": [{"id": "ministry"}], "records": []})
        shape = parse_resource_shape(payload, "x")
        assert shape.fields == [("ministry", "(empty in the first record)")]


class TestApiUrl:
    def test_a_missing_key_is_refused_with_instructions(self, settings: Settings) -> None:
        keyless = replace(settings, ogd_api_key="")
        with pytest.raises(ValueError, match="Generate Your New API KEY"):
            _api_url("https://api.data.gov.in/lists", keyless, limit=1)

    def test_the_key_is_never_what_gets_recorded(self, settings: Settings) -> None:
        # The catalogue URL carries the key, and everything downstream of a
        # fetch records the redacted form.
        url = _api_url("https://api.data.gov.in/lists", settings, limit=5)
        assert settings.ogd_api_key in url
        assert settings.ogd_api_key not in public_url(url)
