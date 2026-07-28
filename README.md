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
docs             Public compliance and disclaimer notes
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

### AI layer, on local models by default

The agent layer (extraction assist, entity resolution, anomaly narratives,
verification) runs on a local Llama model through [Ollama](https://ollama.com) by
default, so a deployment needs no API key and no data leaves the machine. Install
Ollama, then pull the model the tiers default to:

```bash
ollama pull llama3.1:8b
```

That is the whole setup: `AGENT_PROVIDER=ollama` is the default and the three
model tiers resolve to `llama3.1:8b` out of the box. Point a tier at a larger tag
(for example `llama3.1:70b` for the narrative tier) in `.env` if you have the
VRAM. Set `AGENT_PROVIDER=anthropic` with an `ANTHROPIC_API_KEY` to use the
hosted models instead; the optional live verification web search needs that
provider, as a local model cannot fetch pages.

> **Windows note.** If `docker` is not found, Docker Desktop is installed but not on
> this shell's PATH. Prepend it:
> `$env:Path = "C:\Program Files\Docker\Docker\resources\bin;$env:Path"`.

The local stack binds shifted ports (Postgres 5433, Redis 6380, MinIO 9002/9003) so it
coexists with anything already running rather than silently connecting to the wrong
database.

### Sources that refuse automated access

Several official portals block automated clients or publish figures that only
exist after JavaScript runs. We never work around that. For those, a person
downloads the same public document in a browser and drops it in
`data/intake/<source_id>/` with a short manifest saying where it came from and
who fetched it; the ordinary pipeline then ingests it, and every figure it
produces is labelled on the site as obtained by hand rather than on a schedule.
See [data/intake/README.md](data/intake/README.md).

```bash
uv run python -m pipelines intake template data/intake/union_budget/sumsbe.pdf
uv run python -m pipelines run union_budget --from-intake --dry-run
```

## Deploying

Two routes, both written up in [infra/DEPLOY.md](infra/DEPLOY.md): a self-hosted
stack that runs the whole thing on one machine, and a managed split across
Vercel, a hosted Postgres and an S3 bucket.

```bash
cp .env.production.example .env.production   # then fill it in
docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d --build
```

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

The public methodology and data-source catalogue are published in the running
app, at `/methodology` and `/sources`. Compliance, licensing and the
non-affiliation disclaimer are in
[docs/08-legal-compliance.md](docs/08-legal-compliance.md). The detailed design
and requirement documents are maintained with the project and are not part of the
public repository.

## Data sources and attribution

Compiled from public Government of India sources including the Union Budget portal,
the Controller General of Accounts, PFMS published dashboards, data.gov.in, the
Central Public Procurement Portal, the Press Information Bureau and Parliament
questions, plus Open Budgets India by CivicDataLab. Each carries its licence and
access note in `source_registry` and on the site's data and sources page.

Only public, non-authenticated sources are read. No login, CAPTCHA, paywall or
technical access control is ever bypassed, requests are rate limited to government
domains, and the crawler identifies itself honestly with a contact address.
