# Pipelines — the ingestion layer

Python side of Nidhi Drishti. One module per public source, a shared spine, and
parsers that are pure functions so they can be tested without a network or a
database.

## Layout

```
pipelines/
  lib/          config, fetch, storage, db, runs, validation, drift, alerting
  parsers/      inr_amounts, fy_dates, pdf_table, text_norm
  sources/      one package per source_id in db/seed/02_source_registry.sql
  tests/        pytest, no network, no database
```

## Running a pipeline

```powershell
# every source, listed
uv run python -m pipelines list

# one source, no writes, no S3, no database: fetch and parse only
uv run python -m pipelines run cga_monthly --dry-run

# the real thing (needs docker compose up for Postgres + MinIO)
uv run python -m pipelines run cga_monthly
```

`--dry-run` still fetches politely and still stores nothing. It is the mode to
use while adapting a parser to a source that has just been reorganised.

Tests and linting:

```powershell
uv run pytest pipelines/tests -q
uv run ruff check pipelines
uv run mypy pipelines
```

## The resilience contract

Every source module implements the same seven steps, in this order, and no
module is allowed to reorder or skip one (docs/02 section 5):

1. **fetch** through `lib.fetch.PoliteClient`. Robots.txt is consulted and
   cached, a minimum of two seconds separates two requests to the same domain,
   the User-Agent names the project and a contact address, and authenticated or
   CAPTCHA-protected endpoints are refused by the client itself rather than by
   the discipline of the caller (docs/08 section 1).
2. **store_raw** to object storage, content addressed by sha256 under
   `raw/{source_id}/{yyyy}/{mm}/{sha256}.{ext}`. Identical bytes are never
   uploaded twice, and no artifact is ever deleted: it is the evidence trail if
   a published figure is challenged.
3. **parse** into plain Python rows. Parsers contain no business logic and no
   database access.
4. **validate** the rows against a pydantic schema. A validation failure raises
   `SchemaDriftError`, alerts, and aborts the canonical write. Rows are never
   silently dropped, because a parser that quietly discards two thirds of a
   table produces a chart that is wrong in a way nobody notices.
5. **sanity_check** the run metrics against recent history: row count swing,
   total swing, column-set change, parse-error rate. Findings at `high`
   severity abort the write; `warn` findings are recorded and alerted.
6. **upsert** into the canonical store, idempotent against the
   `fiscal_fact_natural_key` unique index, so re-running a pipeline over the
   same document changes nothing.
7. **record_run** with status `ok`, `drift_alert` or `failed`, plus the metrics
   dict that the ops page charts.

### What "failing well" means here

Government sites reorganise constantly. The URLs in each module are a starting
point held in one constant near the top of the file, and a 404, a redirect to a
search page, or a table that grew a column all produce the same outcome: a
clear drift alert, an unchanged canonical store, and a `drift_alert` run row.
Garbage is never written, and a stale-but-correct dashboard beats a fresh-but-
wrong one every time.

### Amounts

`parsers.inr_amounts` returns `Decimal` in crore, or `NOT_REPORTED`. It raises
`AmbiguousAmountError` when a figure carries no unit and no column-header unit
hint. Guessing that a bare `1234` means crore because it usually does is
exactly the failure mode that puts a hundredfold error on a public chart, so
the row goes to the `parse_error` queue instead.

### Fiscal periods

`parsers.fy_dates` mirrors `packages/core/src/fy.ts` and the SQL helpers in
`db/migrations/0001`. FY2026 runs 2025-04-01 to 2026-03-31, Q1 is April to
June, and April is fiscal month 1. CGA labels such as `April-November 2025` are
cumulative and are stored with `is_cumulative = true`; they are never summed.
