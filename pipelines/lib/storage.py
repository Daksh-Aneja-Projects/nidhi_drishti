"""Content-addressed raw artifact store.

Every byte we ever fetched is kept, immutable, keyed by its own sha256:

    raw/{source_id}/{yyyy}/{mm}/{sha256}.{ext}

Two reasons, both from docs/08 section 5 and CLAUDE.md principle 5. First, the
artifact is the evidence trail: if a published figure is ever challenged we can
show the exact PDF we read and when we read it. Second, parsers are wrong before
they are right, and reprocessing last year's budget with this year's fixed
parser has to be possible without asking the Ministry of Finance for the file
again.

Nothing in this module deletes. There is no delete function, deliberately.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any, Protocol

import structlog

from pipelines.lib.config import Settings, get_settings, require_known_source

log = structlog.get_logger(__name__)

#: content-type to file extension. The extension is cosmetic (the hash is the
#: identity) but it makes an operator browsing the bucket able to tell a budget
#: PDF from a CGA HTML page without downloading it.
_EXTENSION_BY_CONTENT_TYPE: dict[str, str] = {
    "application/pdf": "pdf",
    "text/html": "html",
    "application/xhtml+xml": "html",
    "text/csv": "csv",
    "text/plain": "txt",
    "application/json": "json",
    "application/xml": "xml",
    "text/xml": "xml",
    "application/rss+xml": "xml",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/zip": "zip",
}

_URL_EXTENSION = re.compile(r"\.([A-Za-z0-9]{2,5})(?:[?#].*)?$")


class ObjectStore(Protocol):
    """The slice of the S3 API this module uses. Lets tests pass a fake."""

    def head_object(self, **kwargs: Any) -> Any: ...

    def put_object(self, **kwargs: Any) -> Any: ...

    def get_object(self, **kwargs: Any) -> Any: ...


@dataclass(frozen=True, slots=True)
class ArtifactRef:
    """Pointer to a stored artifact. Goes straight into ``source_record``."""

    source_id: str
    key: str
    sha256: str
    byte_size: int
    content_type: str
    url: str | None
    stored_at: datetime
    #: True when the identical bytes were already in the bucket, so nothing was
    #: uploaded. The pipeline uses this to skip a re-parse.
    already_present: bool


def sha256_hex(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def extension_for(content_type: str, url: str | None = None) -> str:
    """Pick a file extension from the content type, falling back to the URL."""
    normalised = (content_type or "").split(";")[0].strip().lower()
    if normalised in _EXTENSION_BY_CONTENT_TYPE:
        return _EXTENSION_BY_CONTENT_TYPE[normalised]
    if url:
        match = _URL_EXTENSION.search(url)
        if match:
            return match.group(1).lower()
    return "bin"


def artifact_key(
    source_id: str,
    sha256: str,
    extension: str,
    *,
    when: datetime | None = None,
) -> str:
    """Build the storage key.

    The yyyy/mm segments come from the fetch time, not the document date, so an
    operator can find "everything we pulled in November" without a database. The
    hash makes the key collision-proof regardless.
    """
    moment = when or datetime.now(UTC)
    return f"raw/{source_id}/{moment.year:04d}/{moment.month:02d}/{sha256}.{extension}"


@lru_cache(maxsize=4)
def _client_for(
    endpoint: str, region: str, access_key: str, secret_key: str, path_style: bool
) -> ObjectStore:
    import boto3
    from botocore.config import Config

    return boto3.client(  # type: ignore[no-any-return]
        "s3",
        endpoint_url=endpoint or None,
        region_name=region or None,
        aws_access_key_id=access_key or None,
        aws_secret_access_key=secret_key or None,
        config=Config(
            s3={"addressing_style": "path" if path_style else "auto"},
            retries={"max_attempts": 5, "mode": "standard"},
        ),
    )


def get_object_store(settings: Settings | None = None) -> ObjectStore:
    s = (settings or get_settings()).s3
    return _client_for(s.endpoint, s.region, s.access_key, s.secret_key, s.force_path_style)


def _exists(store: ObjectStore, bucket: str, key: str) -> bool:
    try:
        store.head_object(Bucket=bucket, Key=key)
        return True
    except Exception as exc:  # noqa: BLE001 - botocore raises a generated class
        name = type(exc).__name__
        if name in {"ClientError", "NoSuchKey", "404"} or "Not Found" in str(exc):
            return False
        # Anything else is a real storage problem and must not be mistaken for
        # "the object is missing", which would trigger a pointless re-upload or,
        # worse, mask a broken bucket.
        if getattr(exc, "response", {}).get("Error", {}).get("Code") in {"404", "NoSuchKey"}:
            return False
        raise


def store_raw(
    source_id: str,
    url: str | None,
    content: bytes,
    content_type: str,
    *,
    settings: Settings | None = None,
    store: ObjectStore | None = None,
    when: datetime | None = None,
) -> ArtifactRef:
    """Store one fetched artifact, content addressed, and return its reference.

    Idempotent by construction: the key is derived from the content hash, so
    re-fetching an unchanged document finds the key already present and uploads
    nothing. ``already_present`` on the returned ref is how the caller learns it
    can skip the parse.
    """
    require_known_source(source_id)
    if not content:
        raise ValueError(
            f"Refusing to store an empty artifact for {source_id}. An empty body from a "
            f"government portal is a fetch failure, not a document."
        )

    resolved = settings or get_settings()
    bucket = resolved.s3.bucket
    client = store or get_object_store(resolved)

    digest = sha256_hex(content)
    key = artifact_key(source_id, digest, extension_for(content_type, url), when=when)

    if _exists(client, bucket, key):
        log.info("artifact.already_present", source_id=source_id, key=key, bytes=len(content))
        return ArtifactRef(
            source_id=source_id,
            key=key,
            sha256=digest,
            byte_size=len(content),
            content_type=content_type,
            url=url,
            stored_at=when or datetime.now(UTC),
            already_present=True,
        )

    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=content,
        ContentType=content_type or "application/octet-stream",
        Metadata={
            "source-id": source_id,
            # Truncated: S3 user metadata has a 2KB budget and some government
            # URLs are query-string monsters.
            "source-url": (url or "")[:1024],
            "sha256": digest,
        },
    )
    log.info("artifact.stored", source_id=source_id, key=key, bytes=len(content))
    return ArtifactRef(
        source_id=source_id,
        key=key,
        sha256=digest,
        byte_size=len(content),
        content_type=content_type,
        url=url,
        stored_at=when or datetime.now(UTC),
        already_present=False,
    )


def read_raw(
    key: str,
    *,
    settings: Settings | None = None,
    store: ObjectStore | None = None,
) -> bytes:
    """Read an artifact back for reprocessing.

    The hash in the key is verified against the bytes returned. A mismatch means
    the bucket has been tampered with or corrupted, and the evidence trail is
    only worth something if we check it.
    """
    resolved = settings or get_settings()
    client = store or get_object_store(resolved)
    response = client.get_object(Bucket=resolved.s3.bucket, Key=key)
    content: bytes = response["Body"].read()
    expected = key.rsplit("/", 1)[-1].split(".")[0]
    actual = sha256_hex(content)
    if expected != actual:
        raise RuntimeError(
            f"Artifact {key} does not match its own hash (expected {expected}, got {actual})."
        )
    return content
