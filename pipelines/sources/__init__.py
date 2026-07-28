"""One package per source declared in db/seed/02_source_registry.sql.

Every module here exposes:

* ``SOURCE_ID``   the registry id it writes for;
* ``URLS``        one constant holding every entry point, so a reorganised
                  portal is a one-place edit rather than a hunt through the file;
* a pydantic row schema, which is the drift tripwire;
* ``run(...)``    the seven-step pipeline from docs/02 section 5.

The parsing functions are importable on their own and take bytes or strings, so
the test suite exercises the real logic against fixture documents and never
touches the network.
"""

from __future__ import annotations

from collections.abc import Callable
from importlib import import_module
from typing import Any

#: Module path per pipeline name. Imported lazily so that a broken dependency in
#: one source cannot stop every other pipeline from running.
SOURCE_MODULES: dict[str, str] = {
    "union_budget": "pipelines.sources.union_budget.pipeline",
    "cga_monthly": "pipelines.sources.cga_monthly.pipeline",
    "pfms_published": "pipelines.sources.pfms_published.pipeline",
    "cppp_tenders": "pipelines.sources.cppp_tenders.pipeline",
    "gem_stats": "pipelines.sources.gem_stats.pipeline",
    "pib_releases": "pipelines.sources.pib_releases.pipeline",
    "ogd_datasets": "pipelines.sources.ogd_datasets.pipeline",
    "obi_historical": "pipelines.sources.obi_historical.pipeline",
    "sansad_qa": "pipelines.sources.sansad_qa.pipeline",
    # Scheme-specific portals (docs/03 section 2.6, roadmap v1.1).
    "mgnrega": "pipelines.sources.mgnrega.pipeline",
    "pmkisan": "pipelines.sources.pmkisan.pipeline",
    "jal_jeevan": "pipelines.sources.jal_jeevan.pipeline",
    # v2 state budgets (docs/12).
    "state_karnataka": "pipelines.sources.state_karnataka.pipeline",
    "state_odisha": "pipelines.sources.state_odisha.pipeline",
}


def load_runner(name: str) -> Callable[..., Any]:
    """Return the ``run`` callable for a pipeline name."""
    return _load_module(name).run  # type: ignore[no-any-return]


def source_id_for(name: str) -> str:
    """The registry id a pipeline writes for.

    Pipeline names and registry ids deliberately differ (``pfms_published`` is
    the module, ``pfms_pub`` is the registry id), so anything keyed by the
    registry, including the intake drop directories and the object store,
    resolves through here rather than guessing.
    """
    return str(_load_module(name).SOURCE_ID)


def _load_module(name: str) -> Any:
    if name not in SOURCE_MODULES:
        raise KeyError(f"Unknown pipeline {name!r}. Known: {', '.join(sorted(SOURCE_MODULES))}")
    return import_module(SOURCE_MODULES[name])
