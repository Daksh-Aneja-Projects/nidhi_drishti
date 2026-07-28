"""Command-line runner: ``uv run python -m pipelines run <name>``.

Deliberately small. Scheduling belongs to cron or Prefect, not here; this exists
so a person can run one pipeline, see what it did, and get a non-zero exit code
when it did not work.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import UTC, date, datetime
from typing import Any

import structlog

from pipelines.lib.config import get_settings
from pipelines.lib.local_intake import (
    INTAKE_ROOT,
    IntakeError,
    LocalFileClient,
    default_url_for,
    discover_documents,
    load_document,
    write_manifest_template,
)
from pipelines.lib.observability import init_observability, set_run_context
from pipelines.sources import SOURCE_MODULES, load_runner, source_id_for


def configure_logging(*, json_output: bool) -> None:
    """Structured logs. JSON in production, readable in a terminal."""
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=logging.INFO)
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.StackInfoRenderer(),
            (
                structlog.processors.JSONRenderer()
                if json_output
                else structlog.dev.ConsoleRenderer(colors=False)
            ),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        cache_logger_on_first_use=True,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="pipelines", description=__doc__)
    parser.add_argument("--json-logs", action="store_true", help="emit JSON log lines")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list", help="list the available pipelines")

    run_parser = sub.add_parser("run", help="run one pipeline")
    run_parser.add_argument("name", choices=sorted(SOURCE_MODULES))
    run_parser.add_argument(
        "--dry-run",
        action="store_true",
        help="fetch and parse, write nothing to the database",
    )
    run_parser.add_argument("--url", help="override the source URL, for testing a moved page")
    run_parser.add_argument("--fy", help="fiscal year label, for example FY2026")
    run_parser.add_argument("--dataset", help="registered dataset name (ogd_datasets only)")
    run_parser.add_argument("--csv-url", help="CSV resource URL (obi_historical only)")
    run_parser.add_argument(
        "--as-of",
        help="ISO date the snapshot represents (pfms_published, gem_stats)",
    )
    run_parser.add_argument(
        "--from-file",
        action="append",
        metavar="PATH",
        help=(
            "ingest a document downloaded by hand instead of fetching it. Each file needs a "
            "<file>.manifest.json beside it. Repeatable. See data/intake/README.md"
        ),
    )
    run_parser.add_argument(
        "--from-intake",
        action="store_true",
        help="ingest every manifested document dropped in data/intake/<source>/",
    )
    run_parser.add_argument(
        "--manifest",
        help="manifest for a single --from-file, when it does not sit beside the document",
    )

    intake_parser = sub.add_parser("intake", help="prepare and inspect hand-downloaded documents")
    intake_sub = intake_parser.add_subparsers(dest="intake_command", required=True)

    template_parser = intake_sub.add_parser(
        "template", help="write a manifest skeleton beside a dropped file"
    )
    template_parser.add_argument("path", help="the document that was downloaded")
    template_parser.add_argument("--url", default="", help="the public URL it came from")
    template_parser.add_argument("--by", default="", help="who downloaded it")

    check_parser = intake_sub.add_parser(
        "check", help="validate dropped documents without ingesting anything"
    )
    check_parser.add_argument(
        "source",
        nargs="?",
        choices=sorted(SOURCE_MODULES),
        help="check one source's drop directory; omit to check every one",
    )

    ogd_parser = sub.add_parser("ogd", help="explore the data.gov.in catalogue")
    ogd_sub = ogd_parser.add_subparsers(dest="ogd_command", required=True)

    search_parser = ogd_sub.add_parser("search", help="find resources by keyword")
    search_parser.add_argument("query", help="words to match in the title, for example 'budget'")
    search_parser.add_argument("--limit", type=int, default=20)
    search_parser.add_argument("--offset", type=int, default=0)

    inspect_parser = ogd_sub.add_parser(
        "inspect", help="show one resource's field names and a sample value for each"
    )
    inspect_parser.add_argument("resource_id")
    return parser


def _kwargs_for(name: str, args: argparse.Namespace) -> dict[str, Any]:
    """Only pass a source the arguments it actually declares."""
    kwargs: dict[str, Any] = {"dry_run": args.dry_run}
    if args.url:
        kwargs["url"] = args.url
    if name == "union_budget" and args.fy:
        kwargs["fy"] = args.fy
    if name == "ogd_datasets":
        kwargs["dataset"] = args.dataset or "ministry_wise_expenditure"
        if args.fy:
            kwargs["default_fy"] = args.fy
    if name == "obi_historical":
        if not args.csv_url:
            raise SystemExit("obi_historical needs --csv-url pointing at the published CSV.")
        kwargs["csv_url"] = args.csv_url
        kwargs.pop("url", None)
        if args.fy:
            kwargs["default_fy"] = args.fy
    as_of = date.fromisoformat(args.as_of) if args.as_of else datetime.now(UTC).date()
    if name == "pfms_published":
        kwargs["as_published_on"] = as_of
    if name == "gem_stats":
        kwargs["as_of"] = as_of
    return kwargs


def _intake_client_for(args: argparse.Namespace) -> LocalFileClient | None:
    """Build the disk-backed client when the run is a manual intake.

    Returns None for an ordinary run, which is the only case where the pipeline
    is allowed to touch the network.
    """
    from_file = getattr(args, "from_file", None) or []
    if not from_file and not getattr(args, "from_intake", False):
        return None
    if from_file and getattr(args, "from_intake", False):
        raise SystemExit("Use either --from-file or --from-intake, not both.")

    if from_file:
        if args.manifest and len(from_file) > 1:
            raise SystemExit("--manifest applies to a single --from-file.")
        documents = [
            load_document(path, manifest=args.manifest if len(from_file) == 1 else None)
            for path in from_file
        ]
    else:
        source_id = source_id_for(args.name)
        documents = discover_documents(source_id)
        if not documents:
            raise SystemExit(
                f"Nothing to ingest: no manifested documents in {INTAKE_ROOT / source_id}. "
                f"See data/intake/README.md."
            )
    return LocalFileClient(documents)


def _intake_command(args: argparse.Namespace) -> int:
    """``intake template`` and ``intake check``: the operator-facing half."""
    if args.intake_command == "template":
        target = write_manifest_template(args.path, source_url=args.url, by=args.by)
        print(f"wrote {target}")
        print("Fill in source_url and retrieved_by before running the pipeline.")
        return 0

    names = [args.source] if args.source else sorted(SOURCE_MODULES)
    problems = 0
    total = 0
    for name in names:
        source_id = source_id_for(name)
        directory = INTAKE_ROOT / source_id
        try:
            documents = discover_documents(source_id)
        except IntakeError as exc:
            problems += 1
            print(f"{name:<18} PROBLEM  {exc}")
            continue
        if not documents and not args.source:
            continue
        if not documents:
            print(f"{name:<18} empty    {directory}")
            continue
        for document in documents:
            total += 1
            manifest = document.manifest
            print(
                f"{name:<18} ok       {document.path.name}\n"
                f"{'':<18}          url={manifest.source_url}\n"
                f"{'':<18}          retrieved={manifest.retrieved_at.isoformat()} "
                f"by {manifest.retrieved_by}"
            )
    print(f"\n{total} document(s) ready, {problems} problem(s).")
    return 1 if problems else 0


def _ogd_command(args: argparse.Namespace) -> int:
    """Read-only catalogue exploration. Registers nothing; prints for a person."""
    from pipelines.sources.ogd_datasets.catalog import describe_resource, search_datasets

    try:
        if args.ogd_command == "search":
            entries = search_datasets(args.query, limit=args.limit, offset=args.offset)
            if not entries:
                print(f"No resources matched {args.query!r}.")
                return 1
            for entry in entries:
                print(entry.as_line())
                print()
            print(
                f"{len(entries)} result(s). Inspect one with: python -m pipelines ogd inspect <id>"
            )
            return 0

        print(describe_resource(args.resource_id).as_report())
        return 0
    except ValueError as exc:
        # Almost always the missing key, and the message says how to get one.
        print(str(exc), file=sys.stderr)
        return 1


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    configure_logging(json_output=bool(args.json_logs))
    # Armed once per process, before anything can fail. A no-op without
    # SENTRY_DSN, so local runs and CI stay silent (docs/09 plane B).
    init_observability("pipeline")

    if args.command == "list":
        settings = get_settings()
        print(f"data mode: {settings.data_mode}")
        for name, module in sorted(SOURCE_MODULES.items()):
            print(f"  {name:<18} {module}")
        return 0

    if args.command == "ogd":
        return _ogd_command(args)

    if args.command == "intake":
        try:
            return _intake_command(args)
        except IntakeError as exc:
            # A manifest problem is an operator mistake, not a crash. A
            # traceback here would bury the one line that says what to fix.
            print(f"intake: {exc}", file=sys.stderr)
            return 1

    # Tags every event this run produces with the source id, so a crash in
    # Sentry is attributable without cross-referencing the pipeline_run table.
    set_run_context(source_id=args.name)
    runner = load_runner(args.name)
    kwargs = _kwargs_for(args.name, args)

    try:
        intake_client = _intake_client_for(args)
    except IntakeError as exc:
        print(f"intake: {exc}", file=sys.stderr)
        return 1
    if intake_client is not None:
        kwargs["client"] = intake_client
        # Point the pipeline at a document the operator actually downloaded,
        # rather than at its own default entry point, which nothing can serve.
        # obi_historical takes its entry point as --csv-url and has no url
        # parameter at all.
        if args.name != "obi_historical" and "url" not in kwargs:
            kwargs["url"] = default_url_for(intake_client.documents)
        print(
            f"intake: {len(intake_client.documents)} hand-downloaded document(s); "
            f"nothing will be fetched over the network."
        )

    if args.dry_run:
        outcome = runner(**kwargs)
    else:
        from pipelines.lib.db import connect

        with connect() as conn:
            outcome = runner(conn=conn, **kwargs)

    print(json.dumps(outcome.as_dict(), indent=2, default=str))
    # drift_alert is not success. A scheduler that treats it as success will
    # keep a quietly broken source running for weeks.
    return 0 if outcome.status == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
