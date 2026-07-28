"""Finding and inspecting data.gov.in resources before registering one.

Registering a dataset is a deliberate act (docs/03): somebody has to look at the
resource, decide what its numbers mean, and write down the unit. That decision
cannot be automated, but the tedious half of it can be, and doing it by hand
means pasting an API key into a browser and squinting at raw JSON.

Two operations, both read-only:

* :func:`search_datasets` asks the catalogue what exists, by keyword;
* :func:`describe_resource` pulls one record and reports the field names and a
  sample value for each, which is exactly what
  :class:`~pipelines.sources.ogd_datasets.pipeline.DatasetSpec` needs filled in.

Neither writes anything, to the database or to the registry. What they produce
is a printout for a person to read and then act on.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import structlog

from pipelines.lib.config import Settings, get_settings
from pipelines.lib.fetch import PoliteClient

log = structlog.get_logger(__name__)

#: The catalogue endpoint. Undocumented in places and generous with its field
#: names, so everything read out of it is defensive.
CATALOG_URL = "https://api.data.gov.in/lists"

#: Anyone with an account can publish a chart's backing table to
#: visualize.data.gov.in, and those land in the same catalogue as the ministries'
#: own releases. They are excluded by default: a figure published here has to
#: come from the institution that issued it, not from another member of the
#: public. Pass ``official_only=False`` to see them.
COMMUNITY_SOURCE = "visualize.data.gov.in"

#: Fields the catalogue has used for a resource's own id, in the order we try
#: them. `index_name` is the current one; the others appear in older responses
#: and in the portal's own examples.
_ID_FIELDS = ("index_name", "resource_id", "id", "index")

_TITLE_FIELDS = ("title", "desc", "description", "name")
_ORG_FIELDS = ("org_type", "org", "source", "ministry")


@dataclass(frozen=True, slots=True)
class CatalogEntry:
    """One resource as the catalogue describes it."""

    resource_id: str
    title: str
    organisation: str
    sector: str
    updated: str

    def as_line(self) -> str:
        return (
            f"{self.resource_id}\n"
            f"    {self.title}\n"
            f"    {self.organisation}"
            + (f" | {self.sector}" if self.sector else "")
            + (f" | updated {self.updated}" if self.updated else "")
        )


def _first(record: dict[str, Any], names: tuple[str, ...]) -> str:
    for name in names:
        value = record.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, list) and value:
            return ", ".join(str(item) for item in value if item)
    return ""


def _api_url(base: str, settings: Settings, **params: str | int) -> str:
    if not settings.ogd_api_key:
        raise ValueError(
            "OGD_API_KEY is not set. The key is free: log in at data.gov.in, open My Account, and "
            "use 'Generate Your New API KEY'."
        )
    # Values are percent-encoded: filter values carry spaces, and an unencoded
    # space truncates the query at the portal's end without saying so.
    query = urlencode({"api-key": settings.ogd_api_key, "format": "json", **params})
    return f"{base}?{query}"


def parse_catalog_payload(payload: str | bytes) -> list[CatalogEntry]:
    """Read a catalogue response into entries.

    Tolerant on purpose. The portal has changed this response's shape more than
    once, and a search tool that raises on an unfamiliar key is less useful than
    one that shows what it could read.
    """
    document = json.loads(payload)
    records = document.get("records") or document.get("data") or []
    entries: list[CatalogEntry] = []
    for record in records:
        if not isinstance(record, dict):
            continue
        resource_id = _first(record, _ID_FIELDS)
        if not resource_id:
            continue
        entries.append(
            CatalogEntry(
                resource_id=resource_id,
                title=_first(record, _TITLE_FIELDS) or "(untitled)",
                organisation=_first(record, _ORG_FIELDS),
                sector=_first(record, ("sector",)),
                updated=_first(record, ("updated_date", "updated", "created_date")),
            )
        )
    return entries


def search_datasets(
    query: str,
    *,
    client: PoliteClient | None = None,
    settings: Settings | None = None,
    limit: int = 20,
    offset: int = 0,
    official_only: bool = True,
) -> list[CatalogEntry]:
    """Search the catalogue by keyword, official publications first."""
    resolved = settings or get_settings()
    owns_client = client is None
    http = client or PoliteClient(resolved)
    params: dict[str, str | int] = {"limit": limit, "offset": offset}
    if query:
        params["filters[title]"] = query
    if official_only:
        params["notfilters[source]"] = COMMUNITY_SOURCE
    try:
        result = http.get(_api_url(CATALOG_URL, resolved, **params))
    finally:
        if owns_client:
            http.close()
    return parse_catalog_payload(result.content)


@dataclass(frozen=True, slots=True)
class ResourceShape:
    """What one resource's records look like, for filling in a DatasetSpec."""

    resource_id: str
    title: str
    record_count: int | None
    fields: list[tuple[str, str]]
    updated: str

    def as_report(self) -> str:
        lines = [
            f"resource: {self.resource_id}",
            f"title:    {self.title}",
        ]
        if self.record_count is not None:
            lines.append(f"records:  {self.record_count}")
        if self.updated:
            lines.append(f"updated:  {self.updated}")
        lines.append("")
        lines.append("fields (name, first value seen):")
        width = max((len(name) for name, _ in self.fields), default=0)
        for name, sample in self.fields:
            lines.append(f"  {name.ljust(width)}  {sample}")
        lines.append("")
        lines.append(
            "Register it in DATASETS in pipelines/sources/ogd_datasets/pipeline.py: pick\n"
            "entity_field, amount_field and fy_field from the list above, and state the unit\n"
            "the amounts are in. The unit is not optional and is not guessable from the\n"
            "numbers: a bare figure from an API is exactly as ambiguous as one in a PDF.\n"
            "Then add the licence note to db/seed/02_source_registry.sql (docs/03)."
        )
        return "\n".join(lines)


def parse_resource_shape(payload: str | bytes, resource_id: str) -> ResourceShape:
    document = json.loads(payload)
    records = document.get("records") or []
    declared = [
        str(item.get("id") or item.get("name"))
        for item in (document.get("field") or [])
        if item.get("id") or item.get("name")
    ]
    sample = records[0] if records and isinstance(records[0], dict) else {}
    names = declared or sorted(str(key) for key in sample)

    fields: list[tuple[str, str]] = []
    for name in names:
        value = sample.get(name, "")
        text = "" if value is None else str(value)
        fields.append((name, text[:60] if text else "(empty in the first record)"))

    count = document.get("total") or document.get("count")
    return ResourceShape(
        resource_id=resource_id,
        title=str(document.get("title") or document.get("desc") or "(untitled)"),
        record_count=int(count) if isinstance(count, int | str) and str(count).isdigit() else None,
        fields=fields,
        updated=str(document.get("updated_date") or document.get("updated") or ""),
    )


def describe_resource(
    resource_id: str,
    *,
    client: PoliteClient | None = None,
    settings: Settings | None = None,
) -> ResourceShape:
    """Fetch a single record and report the resource's field names."""
    resolved = settings or get_settings()
    owns_client = client is None
    http = client or PoliteClient(resolved)
    try:
        url = _api_url(f"https://api.data.gov.in/resource/{resource_id}", resolved, limit=1)
        result = http.get(url)
    finally:
        if owns_client:
            http.close()
    return parse_resource_shape(result.content, resource_id)
