"""Manual intake tests.

Intake is the route by which a human, rather than a client, obtains a document.
That makes it the place where the evidence chain is easiest to weaken by
accident, so the properties under test are the ones that keep it honest:

* a document with no stated origin never enters the chain;
* the declared URL passes the same public-access gate as an automated fetch;
* the retrieval is recorded as manual, with a named person, rather than being
  indistinguishable from a pipeline run;
* a pipeline asking for a document nobody downloaded fails instead of quietly
  going to the network.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from pipelines.lib.local_intake import (
    MANIFEST_SUFFIX,
    IntakeError,
    LocalFileClient,
    content_type_for,
    default_url_for,
    discover_documents,
    load_document,
    parse_manifest,
    write_manifest_template,
)

RETRIEVED_AT = datetime(2026, 7, 20, 9, 15, tzinfo=UTC)
BUDGET_URL = "https://www.indiabudget.gov.in/doc/eb/sumsbe.pdf"
PDF_BYTES = b"%PDF-1.4 statement of budget estimates"


def manifest_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "source_url": BUDGET_URL,
        "retrieved_at": RETRIEVED_AT.isoformat(),
        "retrieved_by": "A. Operator <ops@example.org>",
        "document_date": "2026-02-01",
        "title": "Expenditure Budget, summary of budget estimates",
        "note": "Downloaded manually: the portal refuses automated requests.",
    }
    payload.update(overrides)
    return payload


def drop(
    directory: Path,
    name: str = "sumsbe.pdf",
    *,
    content: bytes = PDF_BYTES,
    **overrides: Any,
) -> Path:
    """Write a document and its manifest the way an operator would."""
    directory.mkdir(parents=True, exist_ok=True)
    document = directory / name
    document.write_bytes(content)
    manifest = directory / (name + MANIFEST_SUFFIX)
    manifest.write_text(json.dumps(manifest_payload(**overrides)), encoding="utf-8")
    return document


class TestManifestValidation:
    def test_a_complete_manifest_parses(self) -> None:
        manifest = parse_manifest(manifest_payload(), now=datetime(2026, 7, 28, tzinfo=UTC))
        assert manifest.source_url == BUDGET_URL
        assert manifest.retrieved_by.startswith("A. Operator")
        assert manifest.document_date is not None
        assert manifest.document_date.isoformat() == "2026-02-01"

    def test_the_retrieval_it_produces_is_marked_manual(self) -> None:
        retrieval = parse_manifest(manifest_payload()).as_retrieval()
        assert retrieval.method == "operator_download"
        assert retrieval.by == "A. Operator <ops@example.org>"

    def test_an_unnamed_operator_is_refused(self) -> None:
        with pytest.raises(IntakeError, match="retrieved_by"):
            parse_manifest(manifest_payload(retrieved_by="  "))

    def test_a_missing_source_url_is_refused(self) -> None:
        with pytest.raises(IntakeError, match="source_url"):
            parse_manifest(manifest_payload(source_url=""))

    def test_a_login_url_is_refused_exactly_as_it_would_be_for_a_fetch(self) -> None:
        # The whole compliance posture would be pointless if a human doing the
        # downloading made a login page acceptable evidence.
        with pytest.raises(IntakeError, match="public document URL"):
            parse_manifest(manifest_payload(source_url="https://pfms.nic.in/login/Report.aspx"))

    def test_a_non_http_url_is_refused(self) -> None:
        with pytest.raises(IntakeError, match="public document URL"):
            parse_manifest(manifest_payload(source_url="file:///C:/downloads/sumsbe.pdf"))

    def test_a_naive_timestamp_is_refused(self) -> None:
        with pytest.raises(IntakeError, match="timezone"):
            parse_manifest(manifest_payload(retrieved_at="2026-07-20T09:15:00"))

    def test_a_future_retrieval_time_is_refused(self) -> None:
        ahead = (RETRIEVED_AT + timedelta(days=2)).isoformat()
        with pytest.raises(IntakeError, match="future"):
            parse_manifest(manifest_payload(retrieved_at=ahead), now=RETRIEVED_AT)

    def test_a_future_document_date_is_refused(self) -> None:
        with pytest.raises(IntakeError, match="future"):
            parse_manifest(manifest_payload(document_date="2030-02-01"), now=RETRIEVED_AT)

    def test_a_misspelt_field_is_refused_rather_than_dropped(self) -> None:
        # Silently ignoring "retrievedby" would publish a blank operator name
        # while the manifest looked filled in.
        with pytest.raises(IntakeError, match="Unknown manifest field"):
            parse_manifest(manifest_payload(retrievedby="someone"))

    def test_a_timestamp_with_an_offset_is_normalised_to_utc(self) -> None:
        manifest = parse_manifest(manifest_payload(retrieved_at="2026-07-20T14:45:00+05:30"))
        assert manifest.retrieved_at == datetime(2026, 7, 20, 9, 15, tzinfo=UTC)


class TestLoadingDocuments:
    def test_a_document_without_a_manifest_is_refused(self, tmp_path: Path) -> None:
        orphan = tmp_path / "sumsbe.pdf"
        orphan.write_bytes(PDF_BYTES)
        with pytest.raises(IntakeError, match="No manifest"):
            load_document(orphan)

    def test_an_empty_file_is_refused(self, tmp_path: Path) -> None:
        document = drop(tmp_path, content=b"")
        with pytest.raises(IntakeError, match="empty"):
            load_document(document).read()

    def test_pointing_at_the_manifest_itself_is_refused(self, tmp_path: Path) -> None:
        drop(tmp_path)
        with pytest.raises(IntakeError, match="is a manifest"):
            load_document(tmp_path / ("sumsbe.pdf" + MANIFEST_SUFFIX))

    def test_the_fetch_time_is_the_operators_download_time(self, tmp_path: Path) -> None:
        # Not now(). Freshness on the site describes when the document was
        # obtained, not when somebody got round to running the pipeline.
        result = load_document(drop(tmp_path)).as_fetch_result()
        assert result.fetched_at == RETRIEVED_AT
        assert result.url == BUDGET_URL
        assert result.final_url == BUDGET_URL
        assert result.content == PDF_BYTES
        assert result.retrieval.method == "operator_download"
        assert result.retrieval.document_date is not None

    def test_content_type_comes_from_the_extension_and_can_be_overridden(
        self, tmp_path: Path
    ) -> None:
        assert content_type_for(Path("a.pdf")) == "application/pdf"
        assert content_type_for(Path("a.xlsx")).endswith("spreadsheetml.sheet")
        assert content_type_for(Path("a.unknown")) == "application/octet-stream"
        document = load_document(drop(tmp_path, "report.dat", content_type="application/pdf"))
        assert document.content_type == "application/pdf"


class TestDiscovery:
    def test_documents_are_returned_oldest_download_first(self, tmp_path: Path) -> None:
        # CGA publishes cumulative months; ingesting May before April would put
        # the de-cumulation view in the wrong order.
        directory = tmp_path / "cga_monthly"
        drop(
            directory,
            "may.pdf",
            content=b"%PDF may",
            retrieved_at="2026-06-10T00:00:00+00:00",
            source_url="https://cga.nic.in/may.pdf",
        )
        drop(
            directory,
            "april.pdf",
            content=b"%PDF april",
            retrieved_at="2026-05-10T00:00:00+00:00",
            source_url="https://cga.nic.in/april.pdf",
        )
        found = discover_documents("cga_monthly", root=tmp_path)
        assert [item.path.name for item in found] == ["april.pdf", "may.pdf"]

    def test_readmes_and_placeholders_are_not_documents(self, tmp_path: Path) -> None:
        directory = tmp_path / "union_budget"
        drop(directory)
        (directory / "README.md").write_text("notes", encoding="utf-8")
        (directory / ".gitkeep").write_text("", encoding="utf-8")
        assert [item.path.name for item in discover_documents("union_budget", root=tmp_path)] == [
            "sumsbe.pdf"
        ]

    def test_an_unregistered_source_is_refused(self, tmp_path: Path) -> None:
        from pipelines.lib.config import ConfigError

        with pytest.raises(ConfigError):
            discover_documents("ministry_of_invented_things", root=tmp_path)

    def test_an_empty_directory_is_not_an_error(self, tmp_path: Path) -> None:
        assert discover_documents("union_budget", root=tmp_path) == []


class TestTemplate:
    def test_the_skeleton_is_written_and_is_deliberately_incomplete(self, tmp_path: Path) -> None:
        document = tmp_path / "sumsbe.pdf"
        document.write_bytes(PDF_BYTES)
        target = write_manifest_template(document)
        payload = json.loads(target.read_text(encoding="utf-8"))
        assert payload["source_url"] == ""
        with pytest.raises(IntakeError):
            parse_manifest(payload)

    def test_an_existing_manifest_is_never_overwritten(self, tmp_path: Path) -> None:
        document = drop(tmp_path)
        with pytest.raises(IntakeError, match="not overwriting"):
            write_manifest_template(document)


class TestLocalFileClient:
    def test_it_serves_the_document_for_its_declared_url(self, tmp_path: Path) -> None:
        client = LocalFileClient([load_document(drop(tmp_path))])
        result = client.get(BUDGET_URL)
        assert result.content == PDF_BYTES
        assert client.requests_made == 1

    def test_an_unprovided_url_fails_instead_of_going_to_the_network(self, tmp_path: Path) -> None:
        client = LocalFileClient([load_document(drop(tmp_path))])
        with pytest.raises(IntakeError, match="not part of the intake"):
            client.get("https://www.indiabudget.gov.in/doc/bag/bag1.pdf")

    def test_a_parameterised_request_is_refused(self, tmp_path: Path) -> None:
        client = LocalFileClient([load_document(drop(tmp_path))])
        with pytest.raises(IntakeError, match="parameterised"):
            client.get(BUDGET_URL, params={"page": "2"})

    def test_it_needs_at_least_one_document(self) -> None:
        with pytest.raises(IntakeError):
            LocalFileClient([])

    def test_the_entry_point_is_ambiguous_with_several_documents(self, tmp_path: Path) -> None:
        first = load_document(drop(tmp_path, "a.pdf", source_url="https://cga.nic.in/a.pdf"))
        second = load_document(drop(tmp_path, "b.pdf", source_url="https://cga.nic.in/b.pdf"))
        assert default_url_for([first]) == "https://cga.nic.in/a.pdf"
        with pytest.raises(IntakeError, match="--url"):
            default_url_for([first, second])


class TestAnUnmodifiedPipelineIngestsADroppedDocument:
    """The point of the whole design: source modules know nothing about intake.

    A document downloaded by hand goes through the same parser, the same schema
    validation and the same drift checks as a fetched one, and comes out with
    provenance that says which of the two it was.
    """

    @staticmethod
    def _cga_drop(tmp_path: Path) -> LocalFileClient:
        fixture = Path(__file__).parent / "fixtures" / "cga_monthly_accounts.html"
        document = drop(
            tmp_path / "cga_monthly",
            "monthly-accounts.html",
            content=fixture.read_bytes(),
            source_url="https://cga.nic.in/MonthlyReport.aspx",
            document_date="2026-05-31",
        )
        return LocalFileClient([load_document(document)])

    def test_the_run_completes_and_the_artifact_is_stored(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from pipelines.sources.cga_monthly.pipeline import run

        stored: list[Any] = []
        monkeypatch.setattr(
            "pipelines.lib.ingest.store_raw",
            lambda source_id, url, content, content_type, **kwargs: _fake_ref(
                stored, source_id, url, content, content_type
            ),
        )

        client = self._cga_drop(tmp_path)
        outcome = run(client=client, dry_run=True, url="https://cga.nic.in/MonthlyReport.aspx")

        assert outcome.source_id == "cga_monthly"
        assert outcome.rows_parsed == 5
        assert stored and stored[0].source_id == "cga_monthly"

    def test_nothing_reaches_the_network(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from pipelines.sources.cga_monthly.pipeline import run

        stored: list[Any] = []
        monkeypatch.setattr(
            "pipelines.lib.ingest.store_raw",
            lambda source_id, url, content, content_type, **kwargs: _fake_ref(
                stored, source_id, url, content, content_type
            ),
        )
        # Any attempt to construct a real client would need the network; the
        # intake client is the only reader in play, and it counts its own calls.
        client = self._cga_drop(tmp_path)
        run(client=client, dry_run=True, url="https://cga.nic.in/MonthlyReport.aspx")
        assert client.requests_made == 1

    def test_a_document_the_operator_did_not_download_is_not_fetched_behind_their_back(
        self, tmp_path: Path
    ) -> None:
        from pipelines.sources.cga_monthly.pipeline import run

        client = self._cga_drop(tmp_path)
        with pytest.raises(IntakeError, match="not part of the intake"):
            run(client=client, dry_run=True, url="https://cga.nic.in/SomeOtherReport.aspx")


def _fake_ref(sink: list[Any], source_id: str, url: str | None, content: bytes, ct: str) -> Any:
    from pipelines.lib.storage import ArtifactRef, sha256_hex

    ref = ArtifactRef(
        source_id=source_id,
        key=f"raw/{source_id}/2026/07/{sha256_hex(content)}.html",
        sha256=sha256_hex(content),
        byte_size=len(content),
        content_type=ct,
        url=url,
        stored_at=RETRIEVED_AT,
        already_present=False,
    )
    sink.append(ref)
    return ref
