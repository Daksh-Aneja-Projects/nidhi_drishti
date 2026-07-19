# 02 — System Architecture & Tech Stack

## 1. High-level design

```
┌────────────────────────────────────────────────────────────────┐
│                        INGESTION LAYER (Python)                │
│  fetchers (per-source) → raw artifact store (S3/MinIO)         │
│  → parsers (PDF/CSV/HTML) → schema validation → staging tables │
└───────────────┬────────────────────────────────────────────────┘
                │
┌───────────────▼────────────────────────────────────────────────┐
│                RECONCILIATION & CANONICAL STORE                │
│  Postgres: canonical fiscal model (BE/RE/sanction/release/     │
│  utilization) + provenance on every row                        │
│  dbt-style transforms; entity resolution (ministry/scheme IDs) │
└───────────────┬────────────────────────────────────────────────┘
                │
┌───────────────▼───────────────┐   ┌───────────────────────────┐
│   AGENT LAYER (Python)        │   │   API (TypeScript)        │
│  - anomaly detection          │   │  REST + cached aggregates │
│  - verification agent         │   │  public read-only         │
│  - drift sentinel             │   └────────────┬──────────────┘
│  - narrative generator        │                │
└───────────────────────────────┘   ┌────────────▼──────────────┐
                                    │  WEB (Next.js dashboard)  │
                                    └───────────────────────────┘
```

## 2. Tech stack (decided — don't relitigate without reason)
| Layer | Choice | Why |
|---|---|---|
| Web | Next.js 15 (App Router), React, Tailwind, Recharts/ECharts | SSR for SEO (public pages must be indexable), fast charts |
| API | Node/TypeScript (Fastify) or Next API routes for v1 | Simple; most endpoints are cached aggregates |
| DB | PostgreSQL 16 | Relational fiscal model, window functions for burn-rate/anomaly SQL |
| Cache | Redis | Aggregate caching, rate limiting |
| Object store | S3-compatible (MinIO local, R2/S3 prod) | Raw artifacts (every fetched PDF/CSV/HTML, immutable, content-hashed) |
| Pipelines | Python 3.12, `httpx`, `pandas`, `pdfplumber`/`camelot` for PDF tables, `playwright` for JS-rendered dashboards | Government PDFs are the boss fight; these tools handle them |
| Orchestration | Prefect (or cron + simple runner in v1) | Scheduling, retries, alerting |
| Agents | Python + Anthropic API (Claude), structured outputs | Verification narratives, PDF table extraction fallback, entity resolution assist |
| Search | Postgres FTS in v1; Meilisearch if needed | Keep infra small |
| Infra | Docker Compose local; single VPS or Railway/Fly for v1; move to managed later | Solo-builder friendly |
| Monitoring | Sentry + a `pipeline_runs` table + Slack/Telegram webhook alerts | Drift detection is product-critical |

## 3. Repo layout (monorepo, pnpm + uv)
```
/apps
  /web          # Next.js dashboard
  /api          # Fastify API (or merged into web for v1)
/pipelines      # Python: one module per source
  /sources
    union_budget/
    cga_monthly/
    pfms_published/
    cppp_tenders/
    gem_contracts/
    pib_releases/
    ogd_datasets/
  /parsers      # pdf_table.py, inr_amounts.py, fy_dates.py
  /lib          # storage, db, validation, alerting
/agents         # verification, anomaly, drift-sentinel, narrative
/db             # migrations (sqitch or drizzle-kit), seed, dbt-style SQL transforms
/docs
/infra          # docker-compose, deploy scripts
```

## 4. Data flow rules
1. **Fetch → store raw first.** Content-hash the artifact; skip re-parse if hash unchanged. Raw artifacts are never deleted (reprocessing + audit trail).
2. **Parse → staging.** Parsers write to `stg_*` tables with zero business logic. Pydantic schema validation at this boundary; failures alert, never silently drop rows.
3. **Transform → canonical.** SQL transforms map staging to the canonical fiscal model (docs/04), performing entity resolution via the `entity_alias` table.
4. **Aggregate → serve.** Materialized views for dashboard aggregates, refreshed post-pipeline; API reads only views/canonical, never staging.
5. **Agents read canonical, write to their own tables** (`anomaly_flag`, `verification_report`). Agents NEVER mutate fiscal facts.

## 5. Scraper resilience pattern (mandatory for every source)
```python
artifact = fetch(url)                     # retries, backoff, UA, robots-aware
store_raw(artifact)                       # S3, content-hashed
rows = parse(artifact)                    # source-specific
validate(rows, SourceSchema)             # pydantic; on fail -> DriftAlert, abort write
diff = sanity_check(rows, last_run)      # row count ±50%? totals swing wildly? -> alert
upsert_staging(rows, run_id)
record_run(run_id, status, metrics)
```

## 6. Caching & performance
- All public dashboard endpoints served from materialized views + Redis (TTL = pipeline cadence). Target p95 < 300ms.
- ISR/static generation for ministry/scheme pages; revalidate on pipeline completion webhook.

## 7. Security
- Public app is read-only; no user PII in v1 (no accounts needed; optional email for alerts in v1.1).
- Admin/review UI behind auth (Clerk/Auth.js) for anomaly review queue.
- Rate-limit public API (Redis token bucket). CORS locked to app domain except documented API routes.
