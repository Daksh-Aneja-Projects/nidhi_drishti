"""Operator document intake: ingesting a file a human downloaded by hand.

Several Tier 1 sources cannot be read by an automated client. Some disallow it
in robots.txt, some sit behind a WAF that refuses any non-browser request, and
some publish a page that only exists after JavaScript has run. docs/08 section 1
already names the answer for those cases, and it is not a cleverer scraper: it
is "a manual periodic download, recorded in ``source_registry.access_note``".

This module is that route, made first-class instead of improvised:

1. a person opens the portal in an ordinary browser and downloads the document,
   which is exactly the access the publisher intends to offer;
2. they drop the file in ``data/intake/<source>/`` next to a small manifest
   stating where it came from, when they downloaded it, and who they are;
3. :class:`LocalFileClient` replays that file to an unmodified pipeline.

The pipeline cannot tell the difference, which is the point: the same parser,
the same schema validation, the same drift checks, the same content-addressed
artifact in object storage. What does differ is the provenance row. Every
``source_record`` written this way is marked ``operator_download`` with the
operator's name, and the site says so under the figure. A number obtained by
hand is still evidence; a number whose retrieval is misdescribed is not.

Two things this is not. It is not a way to enter figures manually: the manifest
carries no amounts, and the document still has to parse. And it is not a way
around a block: the declared URL passes the same public-access gate as an
automated fetch, so a login page or a CAPTCHA flow is refused here too.
"""

from __future__ import annotations

import json
import mimetypes
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from types import TracebackType
from typing import Any

import structlog

from pipelines.lib.config import REPO_ROOT, require_known_source
from pipelines.lib.fetch import FetchError, FetchResult, Retrieval, check_public_url

log = structlog.get_logger(__name__)

#: Where dropped documents live by default: ``data/intake/<source_id>/``.
INTAKE_ROOT = REPO_ROOT / "data" / "intake"

#: Suffix for the manifest that must sit beside every dropped file.
MANIFEST_SUFFIX = ".manifest.json"

#: Content types we can name from a file extension. mimetypes on Windows reads
#: the registry and has been observed returning nothing for .pdf, so the formats
#: these portals actually publish are pinned here rather than trusted to it.
_CONTENT_TYPE_BY_SUFFIX: dict[str, str] = {
    ".pdf": "application/pdf",
    ".htm": "text/html",
    ".html": "text/html",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".json": "application/json",
    ".xml": "application/xml",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".zip": "application/zip",
}


class IntakeError(RuntimeError):
    """A dropped file or its manifest is not fit to enter the evidence chain."""


@dataclass(frozen=True, slots=True)
class IntakeManifest:
    """The provenance an operator asserts about one downloaded file.

    Every field here answers a question the provenance popover asks. None of
    them can be inferred from the bytes, which is why the manifest is mandatory
    rather than optional: a file with no stated origin is not evidence of
    anything, however official it looks.
    """

    #: The public URL the document was downloaded from. Shown to readers as the
    #: source link, so it must be the document's own URL, not a search page.
    source_url: str
    #: When the operator downloaded it. This is the figure's freshness.
    retrieved_at: datetime
    #: Who downloaded it. A name or an address, so the audit trail names a
    #: person rather than "someone, at some point".
    retrieved_by: str
    #: The date the document states for itself, if it states one.
    document_date: date | None = None
    title: str | None = None
    #: Overrides the extension-derived content type when a portal serves a
    #: document with a misleading name, which happens.
    content_type: str | None = None
    #: Free text. In practice: why this was a manual download at all.
    note: str | None = None

    def as_retrieval(self) -> Retrieval:
        return Retrieval(
            method="operator_download",
            by=self.retrieved_by,
            document_date=self.document_date,
            note=self.note,
        )

    def to_jsonable(self) -> dict[str, Any]:
        return {
            "source_url": self.source_url,
            "retrieved_at": self.retrieved_at.isoformat(),
            "retrieved_by": self.retrieved_by,
            "document_date": self.document_date.isoformat() if self.document_date else None,
            "title": self.title,
            "content_type": self.content_type,
            "note": self.note,
        }


def _parse_datetime(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise IntakeError(f"Manifest field {field!r} must be an ISO 8601 timestamp.")
    text = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise IntakeError(
            f"Manifest field {field!r} is not an ISO 8601 timestamp: {value!r}"
        ) from exc
    if parsed.tzinfo is None:
        raise IntakeError(
            f"Manifest field {field!r} has no timezone. Storage is UTC throughout, and a naive "
            f"timestamp on a fetch time silently shifts a figure's freshness by hours."
        )
    return parsed.astimezone(UTC)


def _parse_date(value: Any, field: str) -> date | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise IntakeError(f"Manifest field {field!r} must be an ISO date, for example 2026-02-01.")
    try:
        return date.fromisoformat(value.strip())
    except ValueError as exc:
        raise IntakeError(f"Manifest field {field!r} is not an ISO date: {value!r}") from exc


def parse_manifest(payload: Mapping[str, Any], *, now: datetime | None = None) -> IntakeManifest:
    """Validate a decoded manifest.

    Kept separate from file reading so the rules are testable without a
    filesystem, and so the same rules apply if a manifest ever arrives over an
    upload form rather than from disk.
    """
    unknown = set(payload) - {
        "source_url",
        "retrieved_at",
        "retrieved_by",
        "document_date",
        "title",
        "content_type",
        "note",
    }
    if unknown:
        # A typo in a provenance field would otherwise be silently dropped, and
        # the reader would see a blank where the operator thought they wrote
        # something.
        raise IntakeError(f"Unknown manifest field(s): {', '.join(sorted(unknown))}.")

    source_url = str(payload.get("source_url", "")).strip()
    if not source_url:
        raise IntakeError(
            "Manifest field 'source_url' is required: where did this document come from?"
        )
    try:
        check_public_url(source_url)
    except FetchError as exc:
        raise IntakeError(
            f"Manifest 'source_url' is not a public document URL: {exc}. Intake records where a "
            f"reader can verify the figure themselves, so the URL has to be one they can open."
        ) from exc

    retrieved_by = str(payload.get("retrieved_by", "")).strip()
    if not retrieved_by:
        raise IntakeError(
            "Manifest field 'retrieved_by' is required. A manual download is only auditable if "
            "the record names who performed it."
        )

    retrieved_at = _parse_datetime(payload.get("retrieved_at"), "retrieved_at")
    moment = now or datetime.now(UTC)
    if retrieved_at > moment:
        raise IntakeError(
            f"Manifest 'retrieved_at' is in the future ({retrieved_at.isoformat()}). Freshness on "
            f"the site is computed from this, so a future timestamp would make stale data look new."
        )

    document_date = _parse_date(payload.get("document_date"), "document_date")
    if document_date and document_date > moment.date():
        raise IntakeError(
            f"Manifest 'document_date' is in the future ({document_date.isoformat()})."
        )

    content_type = (payload.get("content_type") or "").strip() or None
    return IntakeManifest(
        source_url=source_url,
        retrieved_at=retrieved_at,
        retrieved_by=retrieved_by,
        document_date=document_date,
        title=(payload.get("title") or "").strip() or None,
        content_type=content_type,
        note=(payload.get("note") or "").strip() or None,
    )


def manifest_path_for(document: Path) -> Path:
    """The manifest that belongs to a dropped file: ``<file><MANIFEST_SUFFIX>``."""
    return document.with_name(document.name + MANIFEST_SUFFIX)


def load_manifest(path: Path, *, now: datetime | None = None) -> IntakeManifest:
    try:
        raw = path.read_text(encoding="utf-8-sig")
    except OSError as exc:
        raise IntakeError(f"Cannot read manifest {path}: {exc}") from exc
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise IntakeError(f"Manifest {path} is not valid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise IntakeError(f"Manifest {path} must contain a JSON object.")
    return parse_manifest(payload, now=now)


def content_type_for(path: Path, declared: str | None = None) -> str:
    if declared:
        return declared
    suffix = path.suffix.lower()
    if suffix in _CONTENT_TYPE_BY_SUFFIX:
        return _CONTENT_TYPE_BY_SUFFIX[suffix]
    guessed, _ = mimetypes.guess_type(path.name)
    return guessed or "application/octet-stream"


@dataclass(frozen=True, slots=True)
class IntakeDocument:
    """One dropped file plus the provenance asserted about it."""

    path: Path
    manifest: IntakeManifest

    @property
    def content_type(self) -> str:
        return content_type_for(self.path, self.manifest.content_type)

    def read(self) -> bytes:
        try:
            content = self.path.read_bytes()
        except OSError as exc:
            raise IntakeError(f"Cannot read {self.path}: {exc}") from exc
        if not content:
            raise IntakeError(
                f"{self.path} is empty. An empty download is a failed download, and storing it "
                f"would put a zero-byte artifact in the evidence chain."
            )
        return content

    def as_fetch_result(self) -> FetchResult:
        content = self.read()
        return FetchResult(
            url=self.manifest.source_url,
            final_url=self.manifest.source_url,
            status_code=200,
            content=content,
            content_type=self.content_type,
            # The operator's download time, not now. This is what the site shows
            # as "fetched", and it is a fact about the retrieval, not about when
            # somebody got round to running the pipeline.
            fetched_at=self.manifest.retrieved_at,
            headers={},
            retrieval=self.manifest.as_retrieval(),
        )


def load_document(path: Path | str, *, manifest: Path | str | None = None) -> IntakeDocument:
    """Load one dropped file and the manifest sitting beside it."""
    document = Path(path).expanduser().resolve()
    if not document.is_file():
        raise IntakeError(f"No such intake file: {document}")
    if document.name.endswith(MANIFEST_SUFFIX):
        raise IntakeError(
            f"{document.name} is a manifest, not a document. Pass the document itself; the "
            f"manifest is found beside it."
        )

    manifest_file = (
        Path(manifest).expanduser().resolve() if manifest else manifest_path_for(document)
    )
    if not manifest_file.is_file():
        raise IntakeError(
            f"No manifest for {document.name}. Write {manifest_file.name} beside it, or generate a "
            f"skeleton with: python -m pipelines intake template {document}"
        )
    return IntakeDocument(path=document, manifest=load_manifest(manifest_file))


def discover_documents(source_id: str, *, root: Path | None = None) -> list[IntakeDocument]:
    """Every manifested document dropped for one source, oldest download first.

    Ordering matters for period-bearing sources: CGA's April file has to be
    ingested before its May file so the de-cumulation view sees the months in
    the order they were published.
    """
    require_known_source(source_id)
    directory = (root or INTAKE_ROOT) / source_id
    if not directory.is_dir():
        return []
    documents: list[IntakeDocument] = []
    for candidate in sorted(directory.iterdir()):
        if not candidate.is_file() or candidate.name.endswith(MANIFEST_SUFFIX):
            continue
        if candidate.name.startswith(".") or candidate.name.upper().startswith("README"):
            continue
        documents.append(load_document(candidate))
    documents.sort(key=lambda item: item.manifest.retrieved_at)
    return documents


def write_manifest_template(document: Path | str, *, source_url: str = "", by: str = "") -> Path:
    """Write a skeleton manifest beside a dropped file, and refuse to overwrite.

    The skeleton is deliberately invalid until a person fills it in: the URL and
    the operator's name are the two things nobody but they can know.
    """
    target = manifest_path_for(Path(document).expanduser().resolve())
    if target.exists():
        raise IntakeError(f"{target.name} already exists; not overwriting a provenance record.")
    skeleton = {
        "source_url": source_url,
        "retrieved_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "retrieved_by": by,
        "document_date": None,
        "title": "",
        "content_type": None,
        "note": "Downloaded manually: the portal refuses automated requests.",
    }
    target.write_text(json.dumps(skeleton, indent=2) + "\n", encoding="utf-8")
    return target


class LocalFileClient:
    """A stand-in for :class:`~pipelines.lib.fetch.PoliteClient` backed by disk.

    It answers ``get`` from the documents it was given, matched on the URL the
    operator declared. A URL it was not given is an error rather than a fetch:
    if the pipeline wants a second document, the operator has to have downloaded
    that one too, and inventing a network request here would make one run half
    manual and half automated with no way to tell which figure came from where.
    """

    def __init__(self, documents: Sequence[IntakeDocument]) -> None:
        if not documents:
            raise IntakeError("LocalFileClient needs at least one document.")
        self._by_url: dict[str, IntakeDocument] = {}
        for document in documents:
            self._by_url[document.manifest.source_url] = document
        self.documents = list(documents)
        self.requests_made = 0
        self.seconds_throttled = 0.0

    # -- PoliteClient surface ---------------------------------------------

    def __enter__(self) -> LocalFileClient:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()

    def close(self) -> None:  # nothing to release; present for interface parity
        return None

    def may_fetch(self, url: str) -> bool:
        return True

    def get(
        self,
        url: str,
        *,
        params: Mapping[str, str] | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> FetchResult:
        if params:
            raise IntakeError(
                f"Intake cannot answer a parameterised request for {url}. The operator downloaded "
                f"a document, not an endpoint."
            )
        del headers  # nothing is sent anywhere
        document = self._by_url.get(url)
        if document is None:
            available = "\n  ".join(sorted(self._by_url)) or "(none)"
            raise IntakeError(
                f"This run asked for {url}, which was not part of the intake. Documents provided:\n"
                f"  {available}\n"
                f"Either download that document too, or point the run at one of the above with "
                f"--url."
            )
        self.requests_made += 1
        result = document.as_fetch_result()
        log.info(
            "intake.served",
            url=url,
            path=str(document.path),
            bytes=result.byte_size,
            retrieved_by=document.manifest.retrieved_by,
        )
        return result

    def head(self, url: str, *, headers: Mapping[str, str] | None = None) -> FetchResult:
        return self.get(url, headers=headers)


def default_url_for(documents: Sequence[IntakeDocument]) -> str:
    """The URL a run should be pointed at when the operator gave one document."""
    if len(documents) != 1:
        raise IntakeError(
            "Several documents were provided, so the entry point is ambiguous. Pass --url naming "
            "which one the pipeline should start from."
        )
    return documents[0].manifest.source_url
