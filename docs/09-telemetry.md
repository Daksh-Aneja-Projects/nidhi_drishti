# 09 — Telemetry & Observability

Two distinct planes. Never mix them.

## A. Product analytics (what users do)
- **Stack**: PostHog (self-hosted or EU cloud) — event analytics, funnels, session context without invasive tracking. No ad trackers, no fingerprinting; anonymous by default (no accounts in v1). IP anonymization on.
- **Typed events**: single `analytics.ts` module exporting typed `track()` wrappers; raw string event names elsewhere in the codebase are a lint error.

### Event taxonomy (v1)
| Event | Properties |
|---|---|
| `page_view` | route, entity_type, entity_id, fy |
| `provenance_opened` | metric, entity_id, source_id |
| `chart_interacted` | chart_id, action (hover_series, toggle, drill) |
| `fy_changed` | from, to |
| `search_performed` | query_len, results_count, clicked_rank |
| `compare_built` | entity_ids_count |
| `flag_card_opened` | rule_id, severity, entity_id |
| `verification_viewed` | entity_id, cached (bool), report_age_days |
| `export_csv` | view_id, row_count |
| `share_card_generated` | entity_id, channel |
| `api_docs_viewed` | section |
| `error_reported` | route, category |

### Core dashboards
1. Activation: % of sessions reaching a ministry or scheme page.
2. Trust engagement: provenance_opened per session (our north-star trust metric).
3. Differentiator usage: verification_viewed and flag_card_opened rates.
4. Export/API adoption (leading indicator of journalist/researcher retention).

## B. System observability (what the platform does)
- **Errors**: Sentry — web, API, and Python pipelines/agents (separate projects, shared release tagging internally; never surfaced in UI).
- **Pipelines**: `pipeline_run` table is the source of truth; Grafana (or a simple internal /ops page in v1) charts: runs by status, rows ingested per source, parse-error rate, drift alerts, source staleness (hours since last successful run vs expected cadence).
- **Alerts** (Telegram/Slack webhook): pipeline failure, drift alert, source stale > 2× cadence, API p95 > 500ms, error-rate spike, agent self-check failure rate > 10%.
- **Agent telemetry**: every agent call logs model, prompt_version, tokens, latency, validation pass/fail to an `agent_call` table; weekly cost + quality review query.
- **Uptime**: external monitor (BetterStack/UptimeRobot) on / and /api/health; /api/health checks DB, Redis, and freshest source age.

## C. Privacy stance (ties to docs/08)
- Analytics disclosed on the methodology page. No PII events, no user identifiers in v1. Respect DNT/GPC by dropping analytics entirely for those sessions.
