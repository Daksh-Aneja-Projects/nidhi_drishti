# 07 — Build Roadmap (phase order is mandatory)

Solo-builder pacing with Claude Code. Each phase ends with something demonstrable. Do not start a phase early.

## Phase 0 — Foundation (week 1)
- Monorepo scaffold per docs/02 layout; docker-compose (Postgres 16 + pgvector, Redis, MinIO).
- Migrations for full docs/04 schema; seed fiscal_year, source_registry.
- `pipelines/lib`: storage (content-hashed raw artifacts), db, pydantic validation, run recorder, Telegram alert hook.
- Parsers with tests: `inr_amounts.py`, `fy_dates.py`.
- **Exit**: `docker compose up` + one dummy pipeline run recorded end-to-end.

## Phase 1 — Allocation backbone (weeks 2–3)
- Union Budget pipeline: current FY Expenditure Budget → ministry-level BE/RE facts. PDF/XLS parsing with A1 fallback stubbed (deterministic first).
- Open Budgets India import: 5 FYs of historical BE/RE (fast-tracks history for anomaly baselines).
- Ministry master + entity_alias seeded. `mv_ministry_summary`.
- **Exit**: SQL query answers "FY2027 BE and RE for every ministry" with provenance.

## Phase 2 — Actuals + first dashboard (weeks 4–6)
- CGA monthly pipeline: current FY months + backfill prior FY; de-cumulation view; provisional/revision lineage.
- Next.js app: P1 National Overview + P2 Ministry pages, freshness bar, provenance popovers.
- **Exit**: public URL showing real allocation-vs-spend-vs-balance for all ministries. This is the "it's real" milestone — shareable.

## Phase 3 — Schemes + verification signals (weeks 7–10)
- Scheme master (top 150–200); scheme allocation facts from Budget statements.
- PFMS-published releases pipeline (Playwright). CPPP tender pipeline + A2 entity resolution. PIB pipeline + embeddings.
- P3 Scheme pages.
- **Exit**: scheme page showing allocation, releases, and linked tenders/PIB items.

## Phase 4 — Intelligence (weeks 11–14)
- A3 anomaly rules + admin review queue (simple auth'd UI). P4 flag feed.
- A4 verification agent + P5 verification page (top 50 schemes cached).
- A5 drift sentinel armed on all pipelines.
- **Exit**: end-to-end demo — anomaly flagged, reviewed, published; verification narrative with citations.

## Phase 5 — Launch hardening (weeks 15–16)
- Parliament Q&A pipeline (utilization gold). CSV exports, public API + rate limits, OG share cards, api-docs.
- Load test, Sentry, uptime monitor; legal review pass (docs/08); soft launch to 10 journalists/researchers for feedback.
- **Exit**: public launch.

## Post-launch (v1.x → v2)
- v1.1: daily digest emails/RSS; more schemes; MGNREGA + 2 flagship scheme portals.
- v1.2: Hindi UI; embeds for newsrooms.
- v2: state budgets (start with 2–3 states with good treasury portals — e.g., Karnataka, Rajasthan, Odisha have relatively open data); the private "command view" fork for institutional buyers.

## Standing risks to watch every phase
1. Budget PDF parsing effort is chronically underestimated — timebox, use A1 fallback + manual entry for stragglers rather than blocking.
2. Don't let the agent layer start before Phase 4; a correct boring dashboard beats a clever wrong one.
3. Each new source = registry entry + drift alerts + license note in docs/08, or it doesn't ship.
