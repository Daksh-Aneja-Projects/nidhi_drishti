"""Raw artifact store tests.

The store is the evidence trail (docs/08 section 5), so the properties under
test are immutability and idempotence: the same bytes always land on the same
key, and they are only ever uploaded once.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from pipelines.lib.config import ConfigError, Settings
from pipelines.lib.storage import (
    artifact_key,
    extension_for,
    read_raw,
    sha256_hex,
    store_raw,
)
from pipelines.tests.conftest import FakeObjectStore

WHEN = datetime(2025, 11, 30, 12, 0, tzinfo=UTC)
PDF_BYTES = b"%PDF-1.4 monthly accounts november 2025"


class TestKeys:
    def test_key_shape(self) -> None:
        digest = sha256_hex(PDF_BYTES)
        key = artifact_key("cga_monthly", digest, "pdf", when=WHEN)
        assert key == f"raw/cga_monthly/2025/11/{digest}.pdf"

    def test_the_key_is_the_content_hash(self) -> None:
        first = artifact_key("cga_monthly", sha256_hex(b"a"), "pdf", when=WHEN)
        second = artifact_key("cga_monthly", sha256_hex(b"b"), "pdf", when=WHEN)
        assert first != second

    @pytest.mark.parametrize(
        ("content_type", "url", "expected"),
        [
            ("application/pdf", None, "pdf"),
            ("text/html; charset=utf-8", None, "html"),
            ("text/csv", None, "csv"),
            ("application/json", None, "json"),
            ("application/octet-stream", "https://x.gov.in/report.xlsx", "xlsx"),
            ("", "https://x.gov.in/a/b/file.PDF?v=2", "pdf"),
            ("", None, "bin"),
        ],
    )
    def test_extension_selection(self, content_type: str, url: str | None, expected: str) -> None:
        assert extension_for(content_type, url) == expected


class TestStoreRaw:
    def test_stores_and_returns_a_reference(
        self, settings: Settings, object_store: FakeObjectStore
    ) -> None:
        ref = store_raw(
            "cga_monthly",
            "https://cga.nic.in/report.pdf",
            PDF_BYTES,
            "application/pdf",
            settings=settings,
            store=object_store,
            when=WHEN,
        )
        assert ref.sha256 == sha256_hex(PDF_BYTES)
        assert ref.byte_size == len(PDF_BYTES)
        assert ref.already_present is False
        assert object_store.puts == 1

    def test_identical_bytes_are_not_uploaded_twice(
        self, settings: Settings, object_store: FakeObjectStore
    ) -> None:
        for _ in range(3):
            ref = store_raw(
                "cga_monthly",
                "https://cga.nic.in/report.pdf",
                PDF_BYTES,
                "application/pdf",
                settings=settings,
                store=object_store,
                when=WHEN,
            )
        assert object_store.puts == 1
        assert ref.already_present is True

    def test_different_bytes_get_different_keys(
        self, settings: Settings, object_store: FakeObjectStore
    ) -> None:
        first = store_raw(
            "cga_monthly",
            None,
            b"one",
            "application/pdf",
            settings=settings,
            store=object_store,
            when=WHEN,
        )
        second = store_raw(
            "cga_monthly",
            None,
            b"two",
            "application/pdf",
            settings=settings,
            store=object_store,
            when=WHEN,
        )
        assert first.key != second.key
        assert object_store.puts == 2

    def test_an_empty_body_is_a_fetch_failure_not_a_document(
        self, settings: Settings, object_store: FakeObjectStore
    ) -> None:
        with pytest.raises(ValueError, match="empty artifact"):
            store_raw(
                "cga_monthly",
                None,
                b"",
                "application/pdf",
                settings=settings,
                store=object_store,
            )

    def test_an_unregistered_source_is_refused(
        self, settings: Settings, object_store: FakeObjectStore
    ) -> None:
        """A source with no registry row cannot be ingested (docs/03)."""
        with pytest.raises(ConfigError):
            store_raw(
                "some_new_portal",
                None,
                PDF_BYTES,
                "application/pdf",
                settings=settings,
                store=object_store,
            )

    def test_there_is_no_delete_function(self) -> None:
        """Artifacts are immutable and never deleted. Assert the API says so."""
        import pipelines.lib.storage as storage

        assert not [name for name in dir(storage) if "delete" in name.lower()]


class TestReadBack:
    def test_read_verifies_the_hash(
        self, settings: Settings, object_store: FakeObjectStore
    ) -> None:
        ref = store_raw(
            "cga_monthly",
            None,
            PDF_BYTES,
            "application/pdf",
            settings=settings,
            store=object_store,
            when=WHEN,
        )
        assert read_raw(ref.key, settings=settings, store=object_store) == PDF_BYTES

    def test_tampered_bytes_are_detected(
        self, settings: Settings, object_store: FakeObjectStore
    ) -> None:
        ref = store_raw(
            "cga_monthly",
            None,
            PDF_BYTES,
            "application/pdf",
            settings=settings,
            store=object_store,
            when=WHEN,
        )
        object_store.objects[ref.key] = b"tampered"
        with pytest.raises(RuntimeError, match="does not match its own hash"):
            read_raw(ref.key, settings=settings, store=object_store)
