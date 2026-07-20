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
from pipelines.lib.observability import init_observability, set_run_context
from pipelines.sources import SOURCE_MODULES, load_runner


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

    # Tags every event this run produces with the source id, so a crash in
    # Sentry is attributable without cross-referencing the pipeline_run table.
    set_run_context(source_id=args.name)
    runner = load_runner(args.name)
    kwargs = _kwargs_for(args.name, args)

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
