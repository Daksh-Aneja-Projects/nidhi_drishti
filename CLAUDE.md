# CLAUDE.md — Nidhi Drishti (निधि दृष्टि)

**Product**: Public transparency platform tracking India's Union Budget — allocation → sanction → release → utilization — by ministry/scheme/sector, with an AI verification layer that cross-references official spend data against tenders, news, and press releases.

**Working name**: Nidhi Drishti ("vision of funds"). Rename freely.

## Read these first, in order
1. `docs/01-PRD.md` — what we're building and for whom
2. `docs/02-architecture.md` — system design, tech stack, repo layout
3. `docs/03-data-sources.md` — every India data source, access method, refresh cadence, quirks
4. `docs/04-data-model.md` — canonical schema; the reconciliation model is the heart of the product
5. `docs/05-agents.md` — the AI agent layer (ingestion, reconciliation, anomaly, verification)
6. `docs/06-frontend-spec.md` — dashboard UX
7. `docs/07-roadmap.md` — build phases; ALWAYS build in phase order
8. `docs/08-legal-compliance.md` — scraping rules, disclaimers, data licensing
9. `docs/09-telemetry.md` — product analytics and system observability

## Non-negotiable principles
1. **Never fabricate a number.** Every figure on screen must trace to a `source_record` row with a URL/document reference and fetch timestamp. If data is missing, show "Not reported" — never interpolate silently.
2. **Allocation ≠ spend.** The pipeline models five distinct stages: Budget Estimate (BE) → Revised Estimate (RE) → Sanction → Release/Disbursement → Utilization. Never conflate them in code, schema, or UI.
3. **Provenance everywhere.** Every metric has a "source" affordance in the UI (source name, document, date fetched, confidence).
4. **Graceful staleness.** Government sources go down, change format, and lag. Every ingested dataset carries `as_of_date` and the UI displays data freshness prominently.
5. **Scrapers are brittle by design-assumption.** Every scraper must: (a) validate output against a schema, (b) alert on structural drift instead of writing garbage, (c) store the raw fetched artifact (HTML/PDF/CSV) in object storage for reprocessing.
6. **This is a read-only transparency tool.** No claims of official affiliation. Disclaimer on every page (see docs/08).

## UI standards (mandatory, applies to every screen)
- **Icons**: premium SVG icons only (Lucide as the standard set; Phosphor acceptable). NEVER emojis anywhere in the UI, including empty states, toasts, and flag cards.
- **Design quality**: advanced, distinctive UI per docs/06 — never generic template/bootstrap aesthetics. Read the frontend-design skill before building any screen.
- **Copy**: never use em-dashes in any UI string; use commas, periods, or restructure the sentence.
- **No version references in the UI**: no "v1", "beta", version numbers, or build strings anywhere user-facing. (Provenance metadata like document dates and prompt_version stays in the database and admin UI only.)
- **Telemetry**: proper product analytics from day one — see docs/09-telemetry.md. Every page view, chart interaction, provenance popover open, export, and verification generation is an event.

## Conventions
- Monorepo, TypeScript end-to-end except scrapers/ETL and agents (Python).
- Money: store as `NUMERIC(20,2)` in INR crore; never floats. Display with Indian digit grouping (₹1,23,456 cr).
- Fiscal year: India FY runs Apr 1–Mar 31. FY2026 = 2025-04-01 to 2026-03-31. All time bucketing is FY-aware; quarter Q1 = Apr–Jun.
- All timestamps UTC in storage, IST (Asia/Kolkata) in display.
- Tests required for: reconciliation math, FY bucketing, currency parsing (lakh/crore/₹ formats), scraper schema validation.
- Commit style: conventional commits.

## Commands (once scaffolded)
- `pnpm dev` — web app
- `pnpm --filter api dev` — API
- `uv run pipelines/<name>.py` — run a pipeline locally
- `docker compose up` — Postgres + Redis + MinIO local stack

## When ambiguous
Prefer the smaller, verifiable implementation. Ask before adding a new external dependency for data (each new source needs an entry in docs/03 with license notes).
