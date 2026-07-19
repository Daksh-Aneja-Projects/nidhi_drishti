# Nidhi Drishti (निधि दृष्टि)

A public transparency platform that tracks India's Union Budget from allocation to
utilisation, by ministry, scheme and sector, with an AI verification layer that
cross-references official spend figures against tenders, press releases and news.

**Every figure on screen traces to a source document with a fetch timestamp. If a
source does not publish a number, the interface says "Not reported" and never
estimates one.**

Not affiliated with the Government of India. See [docs/08-legal-compliance.md](docs/08-legal-compliance.md).

---

## What it does

The Indian fiscal pipeline has five distinct stages, and conflating any two of them
produces a chart that lies:

```
BE (Budget Estimate, 1 Feb)
  -> RE (Revised Estimate) [+ Supplementary Grants]
    -> Sanction
      -> Release / Disbursement
        -> Utilisation
```

Allocation is not spend. The product models all five separately and shows, per
ministry and scheme: the live spending authority, expenditure accounted to date,
the balance, and the **spending pace** against the share of the financial year
elapsed. On top of that sit rule-based signals with published methodology and an
AI narrative layer that is labelled, cited, and fact-checked against the figures
it was given.

## Repository layout

```
apps/web         Next.js dashboard and the public read-only API
packages/core    Shared contract: money, fiscal year, domain types, analytics taxonomy
db               Postgres schema, migrations, seeds, and the data access layer
pipelines        Python ingestion, one module per source, plus parsers
agents           Python AI layer: extraction assist, entity resolution, anomaly, verification
infra            Local Docker stack
docs             Product, architecture, data model, agents, frontend, legal, telemetry
```

## Getting started

Requires Node 20.11+, pnpm, Docker, and [uv](https://docs.astral.sh/uv/) for the
Python side.

```bash
cp .env.example .env
pnpm install

# Postgres 16 with pgvector, Redis, and MinIO for raw artifacts
pnpm db:up
pnpm db:migrate
pnpm db:seed

# Optional: load the clearly labelled illustrative dataset so the dashboard has
# something to render before live ingestion. Every figure it loads is marked
# illustrative, and the interface shows a permanent banner while it is present.
pnpm --filter @nidhi/db seed:demo

pnpm dev            # http://localhost:3000
```

Python side:

```bash
uv sync
uv run pytest                       # parser, pipeline and agent tests
uv run pipelines/sources/cga_monthly/run.py
```

> **Windows note.** If `docker` is not found, Docker Desktop is installed but not on
> this shell's PATH. Prepend it:
> `$env:Path = "C:\Program Files\Docker\Docker\resources\bin;$env:Path"`.

The local stack binds shifted ports (Postgres 5433, Redis 6380, MinIO 9002/9003) so it
coexists with anything already running rather than silently connecting to the wrong
database.

## Commands

| Command | Does |
|---|---|
| `pnpm dev` | Run the web app |
| `pnpm build` | Build every package |
| `pnpm test` | Run the TypeScript test suites |
| `pnpm typecheck` | Typecheck every package |
| `pnpm db:up` / `db:down` | Start and stop the local stack |
| `pnpm db:migrate` | Apply migrations (forward only, checksummed) |
| `pnpm db:seed` | Load reference data and refresh views |
| `pnpm db:refresh` | Rebuild the materialised views |
| `pnpm --filter @nidhi/db check` | Run the docs/04 data invariants |
| `pnpm db:reset` | Drop and recreate the schema (refuses non-local databases) |
| `uv run pytest` | Run the Python test suites |

## The rules this codebase is built around

1. **Never fabricate a number.** Every figure traces to a `source_record` row with a
   URL and a fetch timestamp. Missing data shows as "Not reported", never interpolated.
2. **Allocation is not spend.** The five stages stay distinct in the schema, the API
   and the interface.
3. **Provenance everywhere.** Every displayed number has a source affordance. This is
   enforced by the component API: the thing that renders a figure also renders the
   link to its evidence.
4. **Graceful staleness.** Government sources go down, change format and lag. Every
   dataset carries `as_of_date` and freshness is shown on every page.
5. **Scrapers are assumed brittle.** Every pipeline validates against a schema, alerts
   on structural drift rather than writing garbage, and stores the raw artifact,
   immutable and content-hashed, for reprocessing and audit.
6. **Read only, and never accusatory.** We publish data and methodology, not
   allegations. Every signal carries a plain statement of what it does not establish.

## Documentation

Read in order: [PRD](docs/01-PRD.md), [architecture](docs/02-architecture.md),
[data sources](docs/03-data-sources.md), [data model](docs/04-data-model.md),
[agents](docs/05-agents.md), [frontend spec](docs/06-frontend-spec.md),
[roadmap](docs/07-roadmap.md), [legal](docs/08-legal-compliance.md),
[telemetry](docs/09-telemetry.md), [design system](docs/10-design-system.md).

## Data sources and attribution

Compiled from public Government of India sources including the Union Budget portal,
the Controller General of Accounts, PFMS published dashboards, data.gov.in, the
Central Public Procurement Portal, the Press Information Bureau and Parliament
questions, plus Open Budgets India by CivicDataLab. Each carries its licence and
access note in `source_registry` and on the site's data and sources page.

Only public, non-authenticated sources are read. No login, CAPTCHA, paywall or
technical access control is ever bypassed, requests are rate limited to government
domains, and the crawler identifies itself honestly with a contact address.
