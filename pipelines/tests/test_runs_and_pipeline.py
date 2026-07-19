"""Run bookkeeping and end-to-end dry runs.

A dry run exercises the whole seven-step sequence with a canned HTTP transport
and an in-memory object store: fetch, store, parse, validate, sanity check,
upsert (skipped), record run. Nothing here touches the network or a database.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import pytest

from pipelines.lib.config import Settings
from pipelines.lib.drift import DriftFinding, RunMetrics
from pipelines.lib.runs import PipelineAborted, PipelineRun
from pipelines.lib.storage import ArtifactRef, sha256_hex
from pipelines.tests.conftest import RecordingSleeper, make_client

FIXTURES = Path(__file__).parent / "fixtures"
ROBOTS = "User-agent: *\nAllow: /\n"


@pytest.fixture
def fake_store_raw(monkeypatch: pytest.MonkeyPatch) -> list[ArtifactRef]:
    """Replace object storage with an in-memory recorder.

    Patched at :mod:`pipelines.lib.ingest` because that is where the source
    modules reach it, and the point of the test is what the pipeline does, not
    what boto3 does.
    """
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


def serve_status(status: int) -> Any:
    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text=ROBOTS)
        return httpx.Response(status, text="not found")

    return handle


class TestPipelineRun:
    def test_a_clean_run_is_ok(self) -> None:
        with PipelineRun("cga_monthly", dry_run=True) as run:
            run.metric(row_count=10)
        assert run.status == "ok"
        assert run.metrics["row_count"] == 10
        assert "duration_seconds" in run.metrics

    def test_drift_findings_downgrade_the_run(self) -> None:
        with PipelineRun("cga_monthly", dry_run=True) as run:
            run.add_drift([DriftFinding("row_count_swing", "warn", "moved a lot")])
        assert run.status == "drift_alert"
        assert run.metrics["drift"][0]["check"] == "row_count_swing"

    def test_a_severe_finding_aborts_before_the_write(self) -> None:
        with pytest.raises(PipelineAborted):
            with PipelineRun("cga_monthly", dry_run=True) as run:
                run.abort_if_drifted([DriftFinding("zero_rows", "high", "nothing parsed")])
        assert run.status == "drift_alert"

    def test_a_deliberate_abort_is_not_recorded_as_a_crash(self) -> None:
        run = PipelineRun("cga_monthly", dry_run=True)
        with pytest.raises(PipelineAborted), run:
            run.abort_if_drifted([DriftFinding("zero_rows", "high", "nothing parsed")])
        assert run.status == "drift_alert"

    def test_an_unexpected_exception_is_recorded_as_failed_and_reraised(self) -> None:
        run = PipelineRun("cga_monthly", dry_run=True)
        with pytest.raises(ZeroDivisionError), run:
            _ = 1 / 0
        assert run.status == "failed"
        assert "ZeroDivisionError" in run.metrics["error"]

    def test_an_unregistered_source_cannot_start_a_run(self) -> None:
        from pipelines.lib.config import ConfigError

        with pytest.raises(ConfigError):
            PipelineRun("some_new_portal", dry_run=True)

    def test_decimal_metrics_keep_their_precision(self) -> None:
        with PipelineRun("cga_monthly", dry_run=True) as run:
            run.metric(total=Decimal("5065345.67"))
        assert run.metrics["total"] == "5065345.67"

    def test_run_metrics_block_is_recorded(self) -> None:
        with PipelineRun("cga_monthly", dry_run=True) as run:
            run.set_run_metrics(
                RunMetrics(row_count=5, total_amount_inr_cr=Decimal("10"), columns=("a",))
            )
        assert run.metrics["row_count"] == 5
        assert run.metrics["columns"] == ["a"]

    def test_a_dry_run_has_no_baseline_to_compare_against(self) -> None:
        with PipelineRun("cga_monthly", dry_run=True) as run:
            assert run.baseline() == []


class TestCgaDryRun:
    def test_the_full_sequence_runs_without_a_database(
        self, settings: Settings, fake_store_raw: list[ArtifactRef]
    ) -> None:
        from pipelines.sources.cga_monthly.pipeline import run

        client = make_client(settings, serve("cga_monthly_accounts.html"), RecordingSleeper())
        outcome = run(client=client, dry_run=True, url="https://cga.nic.in/MonthlyReport.aspx")

        assert outcome.source_id == "cga_monthly"
        assert outcome.rows_parsed == 5
        assert outcome.facts_written == 0
        assert outcome.artifacts and outcome.artifacts[0].startswith("raw/cga_monthly/")
        assert "dry run: nothing written" in outcome.notes

    def test_the_artifact_is_stored_before_anything_is_parsed(
        self, settings: Settings, fake_store_raw: list[ArtifactRef]
    ) -> None:
        """Provenance first. A parse failure must still leave the evidence behind."""
        from pipelines.sources.cga_monthly.pipeline import run

        client = make_client(settings, serve("cga_monthly_accounts.html"), RecordingSleeper())
        run(client=client, dry_run=True, url="https://cga.nic.in/MonthlyReport.aspx")
        assert len(fake_store_raw) == 1
        assert fake_store_raw[0].sha256

    def test_a_404_surfaces_as_a_failed_run_not_a_silent_success(
        self, settings: Settings, fake_store_raw: list[ArtifactRef]
    ) -> None:
        from pipelines.lib.fetch import HttpStatusError
        from pipelines.sources.cga_monthly.pipeline import run

        client = make_client(settings, serve_status(404), RecordingSleeper())
        with pytest.raises(HttpStatusError):
            run(client=client, dry_run=True, url="https://cga.nic.in/MovedReport.aspx")
        assert fake_store_raw == []

    def test_a_restructured_page_aborts_on_zero_rows(
        self, settings: Settings, fake_store_raw: list[ArtifactRef]
    ) -> None:
        from pipelines.sources.cga_monthly.pipeline import run

        def handle(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/robots.txt":
                return httpx.Response(200, text=ROBOTS)
            return httpx.Response(
                200,
                content=b"<html><body><h1>Under maintenance</h1></body></html>",
                headers={"content-type": "text/html"},
            )

        client = make_client(settings, handle, RecordingSleeper())
        with pytest.raises(PipelineAborted):
            run(client=client, dry_run=True, url="https://cga.nic.in/MonthlyReport.aspx")

    def test_robots_disallow_stops_the_run_before_any_fetch(
        self, settings: Settings, fake_store_raw: list[ArtifactRef]
    ) -> None:
        from pipelines.lib.fetch import RobotsDisallowed
        from pipelines.sources.cga_monthly.pipeline import run

        def handle(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/robots.txt":
                return httpx.Response(200, text="User-agent: *\nDisallow: /\n")
            raise AssertionError("the page must not be fetched when robots disallows it")

        client = make_client(settings, handle, RecordingSleeper())
        with pytest.raises(RobotsDisallowed):
            run(client=client, dry_run=True, url="https://cga.nic.in/MonthlyReport.aspx")


class TestCpppDryRun:
    def test_tender_listing_runs_end_to_end(
        self, settings: Settings, fake_store_raw: list[ArtifactRef]
    ) -> None:
        from pipelines.sources.cppp_tenders.pipeline import run

        client = make_client(settings, serve("cppp_tender_listing.html"), RecordingSleeper())
        outcome = run(
            client=client,
            dry_run=True,
            url="https://eprocure.gov.in/eprocure/app?page=FrontEndLatestActiveTenders",
        )
        assert outcome.rows_parsed == 4
        assert any("unattached" in note for note in outcome.notes)


class TestPibDryRun:
    def test_release_listing_runs_end_to_end(
        self, settings: Settings, fake_store_raw: list[ArtifactRef]
    ) -> None:
        from datetime import date

        from pipelines.sources.pib_releases.pipeline import run

        client = make_client(settings, serve("pib_release_listing.html"), RecordingSleeper())
        outcome = run(
            client=client,
            dry_run=True,
            url="https://pib.gov.in/allRel.aspx",
            listing_date=date(2025, 11, 21),
        )
        assert outcome.rows_parsed == 4
        assert outcome.status == "ok"


class TestSourceRegistryDiscipline:
    def test_every_source_module_writes_for_a_declared_id(self) -> None:
        """A pipeline may only write for a source seeded in the registry."""
        from importlib import import_module

        from pipelines.lib.config import KNOWN_SOURCE_IDS
        from pipelines.sources import SOURCE_MODULES

        for name, path in SOURCE_MODULES.items():
            module = import_module(path)
            assert module.SOURCE_ID in KNOWN_SOURCE_IDS, name

    def test_every_source_module_keeps_its_urls_in_one_constant(self) -> None:
        from importlib import import_module

        from pipelines.sources import SOURCE_MODULES

        for name, path in SOURCE_MODULES.items():
            module = import_module(path)
            assert isinstance(module.URLS, dict), name
            assert module.URLS, name
            assert all(url.startswith("https://") for url in module.URLS.values()), name

    def test_every_source_module_exposes_run(self) -> None:
        from pipelines.sources import SOURCE_MODULES, load_runner

        for name in SOURCE_MODULES:
            assert callable(load_runner(name)), name
