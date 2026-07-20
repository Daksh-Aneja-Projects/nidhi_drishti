# 11 — Runbook

What to do when an alert from docs/09 section B / infra/monitoring/alerts.yaml
fires. Written for 2am: find the row, run the command, come back and read the
rest only if the fix did not work.

All commands assume the repo root (`D:\nidhi_drishti` locally) and a working
`.env`. `$SITE_URL` below means the deployment's base URL (`http://localhost:3000`
locally).

## Triage table

| Alert (docs/09 / alerts.yaml id) | Section |
|---|---|
| Pipeline failure | [A pipeline has failed](#a-pipeline-has-failed) |
| Drift alert / a scraper has drifted | [A scraper has drifted](#a-scraper-has-drifted) |
| Source stale > 2x cadence | [A source has gone stale](#a-source-has-gone-stale) |
| Invariant check reports an error | [The invariant check reports an error](#the-invariant-check-reports-an-error) |
| Agent self-check failure rate > 10% | [The verification agent's self-check failure rate spikes](#the-verification-agents-self-check-failure-rate-spikes) |
| API p95 > 500ms / error-rate spike | [The API is slow or erroring](#the-api-is-slow-or-erroring) |
| /api/health or / failing the uptime monitor | [The database is down](#the-database-is-down) |

Every pipeline/drift alert arrives on Telegram or the webhook with `source_id`
and, where relevant, `run_id`. Start there; do not start by opening the ops page.

---

## A source has gone stale

**Alert says:** `source_stale`, a source's `hours_since_fetch` is more than
2x its declared cadence.

1. Confirm it, and see every source at once:
   ```bash
   curl -s $SITE_URL/api/health | jq '.checks.sources'
   ```
   or, with the admin token, the full per-source table:
   ```bash
   curl -s -H "x-admin-review-token: $ADMIN_REVIEW_TOKEN" $SITE_URL/ops
   ```
2. Check whether the source is *paused* (A5 drift sentinel may have paused
   canonical writes after an earlier severe drift finding, which also makes
   it look stale):
   ```bash
   uv run python -c "
   from agents.a5_drift_sentinel.pause import FilePauseStore
   from agents.lib.config import get_agent_settings
   store = FilePauseStore(get_agent_settings().state_dir / 'paused_sources.json')
   print(store.paused())
   "
   ```
   If it is paused, that is not this alert's root cause; go to
   [A scraper has drifted](#a-scraper-has-drifted) instead.
3. If it is not paused, run the pipeline by hand and read the output:
   ```bash
   uv run python -m pipelines list          # confirm the exact source name
   uv run python -m pipelines run <name> --dry-run   # fetch + parse, write nothing
   ```
   - **Fetch fails (network/HTTP error)**: the government site is down or has
     moved. Check the URL still resolves in a browser. If it moved
     permanently, update the source module and re-run without `--dry-run`;
     note the change in `docs/03-data-sources.md`.
   - **Fetch succeeds, parse fails**: the page structure changed. This is a
     drift event even though nothing alerted yet (a hand run bypasses the
     alerting in `pipelines/lib/runs.py` only if you catch the exception
     yourself; letting it run normally still records the run and alerts). Go
     to [A scraper has drifted](#a-scraper-has-drifted).
   - **Both succeed**: the scheduler (cron/Prefect) did not run. Check its
     logs, not this repo. Once fixed, run for real:
     ```bash
     uv run python -m pipelines run <name>
     ```
4. Verify: re-check `/api/health` or `/ops`; `hours_since_fetch` should reset
   near zero for that source.

**Do not** treat staleness alone as a reason to touch `/api/health`'s status
code. It reports source freshness but never turns the probe red by design
(`apps/web/src/app/api/health/route.ts`) — stale government data is a
product signal (CLAUDE.md principle 4), not an outage.

---

## A pipeline has failed

**Alert says:** `pipeline_failure` — a run finished with status `failed`: an
uncaught exception, not a deliberate drift abort (that is
[the next section](#a-scraper-has-drifted)).

1. The alert body carries the exception type and message
   (`pipelines/lib/runs.py` records `f"{type(exc).__name__}: {exc}"`). Read
   it before doing anything else; most failures are one of:
   - a network/HTTP error from `pipelines/lib/fetch.py` — the source is
     temporarily unreachable, retry once by hand;
   - a database error (connection refused, constraint violation) — see
     [The database is down](#the-database-is-down) or
     [The invariant check reports an error](#the-invariant-check-reports-an-error);
   - an unhandled exception in the source module itself — a genuine bug,
     usually from an assumption about the page shape that this run broke.
2. Reproduce without writing anything:
   ```bash
   uv run python -m pipelines run <name> --dry-run
   ```
   If it fails the same way locally, you have a repro; fix it and add a
   regression test in `pipelines/tests/` before re-running for real. If it
   does not fail locally, it was likely transient (a timeout, a momentary
   database blip) — re-run for real and watch it succeed:
   ```bash
   uv run python -m pipelines run <name>
   ```
3. If the traceback shows the fetch or parse succeeding but the numbers look
   wrong rather than the process crashing outright, that is
   [a scraper drift](#a-scraper-has-drifted), not this alert; treat it as
   such even if `pipeline_run.status` happened to land on `failed` because
   the drift check itself raised.
4. If Sentry is configured (`SENTRY_DSN`, `pipelines/lib/observability.py`),
   the same exception is there too, tagged with `source_id` and `run_id` —
   useful when the alert body was truncated or the traceback matters more
   than the one-line summary.

---

## A scraper has drifted

**Alert says:** `drift_alert`, a run's row count, totals, columns, or
parse-error rate deviated from its own history
(`pipelines/lib/drift.py::sanity_check`).

1. Read the alert body: it names the specific check(s) that fired
   (`row_count_swing`, `total_amount_swing`, `column_set_changed`,
   `parse_error_rate`, etc.) and their severity. A `high` severity finding
   means A5 already paused canonical writes for that source — staging still
   ingests, nothing is lost, but nothing new is reaching the dashboard.
2. Pull the raw artifact that triggered it and look at it yourself: every
   fetch is stored content-hashed in object storage
   (`pipelines/lib/storage.py`, docs/02 section 4). Find the run:
   ```sql
   SELECT run_id, source_id, started_at, metrics->'drift' AS drift
   FROM pipeline_run
   WHERE status = 'drift_alert'
   ORDER BY started_at DESC LIMIT 5;
   ```
   Then fetch the artifact key it recorded and open it. A structure change
   (new column, merged cells, a redesigned page) is almost always visible on
   sight.
3. Reproduce locally without writing anything:
   ```bash
   uv run python -m pipelines run <name> --dry-run --url <the-same-or-a-fresh-url>
   ```
4. Fix the parser (`pipelines/sources/<name>/`), add or update a fixture in
   `pipelines/tests/`, and confirm:
   ```bash
   uv run pytest pipelines/tests/test_sources_parsing.py -q
   uv run ruff check pipelines/sources/<name>
   ```
5. If the source was auto-paused, resume it once you trust the fix:
   ```bash
   uv run python -c "
   from agents.a5_drift_sentinel.pause import FilePauseStore
   from agents.lib.config import get_agent_settings
   store = FilePauseStore(get_agent_settings().state_dir / 'paused_sources.json')
   print('resumed' if store.resume('<name>') else 'was not paused')
   "
   ```
6. Backfill the gap:
   ```bash
   uv run python -m pipelines run <name>
   pnpm --filter @nidhi/db refresh
   ```
7. Verify: `pnpm --filter @nidhi/db check` should show no new errors for the
   affected FY, and the ops page's parse-error and drift tables should clear
   on the next successful run.

If the page did not change and the swing is real (a genuine large revision,
a new FY's first data point with nothing to compare against), that is a
false positive — the check is heuristic by design (docs/02 section 5). No
code change is needed; the next successful run establishes a new baseline.

---

## The invariant check reports an error

**Alert / symptom:** `pnpm --filter @nidhi/db check` (or the ops page's
"invariants" table) shows an `error`-severity finding. Unlike `warn`/`info`,
`error` means the canonical data is broken, not merely surprising
(`db/migrations/0006_search_and_invariants.sql`).

1. Run it directly and read every line, not just the count:
   ```bash
   pnpm --filter @nidhi/db check          # all fiscal years
   pnpm --filter @nidhi/db check FY2026   # scope to one FY while you work
   ```
2. Match the `invariant` name to what it means:
   - **`fact_without_source`** — a `fiscal_fact` row has no matching
     `source_record`. This should be structurally impossible (the column is
     `NOT NULL` with a foreign key); if it fires, a migration or a manual
     `UPDATE` bypassed the constraint. Find the offending `fact_id` from the
     `detail` column, trace how it was written (check `pipeline_run` around
     that timestamp), and fix the write path before touching the row.
   - **`superseded_fact_visible`** — a fact that another fact's
     `supersedes_fact_id` points at (a revision) is still visible in
     `v_fiscal_fact_current`. This means the "current" view's supersession
     logic broke, most likely from a manual insert that did not go through
     the normal pipeline upsert (`pipelines/lib/db.py`). Do not delete the
     stale row by hand; fix the write path, then re-run the pipeline that
     owns that fact so the correct supersession chain is rebuilt.
3. **Never patch the symptom with a manual UPDATE/DELETE against
   production data.** Every figure must trace to a `source_record`
   (CLAUDE.md principle 1); a hand edit breaks that trace even if the number
   ends up correct. Fix the pipeline or migration that produced the bad row,
   then re-run it.
4. After a fix, re-run the specific pipeline that owns the affected facts,
   refresh views, and re-check:
   ```bash
   uv run python -m pipelines run <name>
   pnpm --filter @nidhi/db refresh
   pnpm --filter @nidhi/db check FY2026
   ```
5. If you are not confident and need a clean slate locally (never on a real
   deployment): `pnpm db:reset` followed by `pnpm db:migrate && pnpm db:seed`
   rebuilds from scratch.

---

## The verification agent's self-check failure rate spikes

**Alert says:** `agent_self_check_failure_rate`, more than 10% of A4's
self-check passes failed over the trailing window (docs/05 A4 step 5,
docs/09 section B).

A failure here does not reach a reader directly — on a failed self-check the
narrative regenerates once, and on a second failure it falls back to the
deterministic template (`agents/a4_verification/fallback.py`) with
`is_fallback = true`. The alert exists because that fallback is a visibly
worse experience (less prose, no synthesis) and a persistently high rate
means something upstream broke.

1. Look at recent failures directly:
   ```sql
   SELECT call_id, entity_type, entity_id, latency_ms, error_text, created_at
   FROM agent_call
   WHERE agent_id = 'A4' AND validation_passed = false
   ORDER BY created_at DESC LIMIT 20;
   ```
2. Narrow down what changed. In order of likelihood:
   - **A prompt edit.** `prompt_version` is a content hash
     (`agents/lib/prompts.py`), so compare the `prompt_version` on recent
     failing calls against `agents/prompts/*.md`'s current hash:
     ```bash
     uv run python -c "from agents.lib.prompts import load_prompt; print(load_prompt('a4_self_check').version)"
     uv run python -c "from agents.lib.prompts import load_prompt; print(load_prompt('a4_verification').version)"
     ```
     If a version bumped around when the rate started climbing, that is the
     first suspect. Re-run the eval suite against the new prompt:
     ```bash
     uv run python -m agents.evals.runner            # replay, no API key needed
     uv run python -m agents.evals.runner --live      # against the real model, needs ANTHROPIC_API_KEY
     ```
   - **A model change.** `AGENT_MODEL_STANDARD` / `AGENT_MODEL_NARRATIVE` in
     `.env` changed, or the provider silently updated the pinned model
     version behind an alias. Check `agent_call.model` on the failing rows.
   - **Bad or missing facts, not a bad narrative.** If `error_text` shows the
     self-check flagging a number that genuinely is not in
     `FactBundle` (rather than a model mistake), the fact assembly
     (`agents/a4_verification/facts.py`) is the bug, not the prompt.
3. If the cause is a prompt or model regression, revert it and confirm the
   rate recovers over the next hour of traffic (or the next eval run).
4. If genuinely nothing changed and this is a one-off model quality dip,
   no action is required beyond watching the rate — the fallback template
   is safe to serve indefinitely; it is worse, not wrong.

---

## The API is slow or erroring

**Alert says:** `api_latency` (p95 > 500ms) or `error_rate_spike`.

1. Check `/api/health` first — a slow API is very often a database or cache
   problem wearing a different alert:
   ```bash
   curl -s -w '\n%{time_total}s\n' $SITE_URL/api/health
   ```
   If `checks.cache.ok` is `false` and cache was previously configured, the
   rate limiter and every cached-aggregate read just fell back to a colder
   path (`apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/api.ts`
   `CACHE_SECONDS`) — this alone explains a latency spike. Fix Redis; no
   code change needed.
2. If the database itself is slow, check for a long-running query or a
   missing index against the materialized views the API reads
   (`db/migrations`, `mv_ministry_summary` etc.) rather than the base tables
   — the API never queries staging or base tables directly (docs/02 rule 4).
3. Reproduce locally against a production build, not `next dev`:
   ```bash
   pnpm --filter @nidhi/web build && pnpm --filter @nidhi/web start
   k6 run infra/load-test/read-paths.js
   ```
   Compare `http_req_duration{endpoint:api_national}` /
   `{endpoint:api_ministries}` against the 300ms budget in that script's
   thresholds (docs/02 section 6). If it fails locally with a warm cache,
   the regression is in the code, not the environment; check recent changes
   to `db/src/queries.ts` or the materialized view definitions.
4. For an error-rate spike specifically, check Sentry (docs/09 plane B —
   configured through `apps/web/sentry.server.config.ts`, never surfaced in
   the UI) for the actual exception grouping before guessing.
5. If everything points at the rate limiter itself misbehaving (letting
   too much or too little through), confirm it directly:
   ```bash
   k6 run infra/load-test/rate-limit.js
   ```
   `rate_limited_responses` should be greater than zero and
   `unexpected_status_responses` should stay at zero; see
   `infra/load-test/README.md`.

---

## The database is down

**Alert says:** the uptime monitor on `/api/health` (`infra/monitoring/uptime.yaml`)
is failing, or `/api/health` itself returns 503 with `checks.database.ok: false`.

1. Confirm from the API's own view, then from the database directly:
   ```bash
   curl -s $SITE_URL/api/health | jq '.checks.database'
   psql "$DATABASE_URL" -c 'select 1;'
   ```
2. If `psql` cannot connect: this is an infrastructure problem (the Postgres
   host/container is down, network policy changed, credentials rotated) —
   fix at that layer. Locally:
   ```bash
   pnpm db:up      # docker compose up -d, from infra/docker-compose.yml
   ```
3. If `psql` connects fine but the app still reports the database
   unreachable: check `DATABASE_URL` in the app's actual runtime environment
   matches what you just tested with, and check connection-pool exhaustion
   (too many open connections against the Postgres max, commonly from a
   leaked client somewhere other than `db/src/client.ts`'s pool).
4. Once the database is back:
   ```bash
   curl -s $SITE_URL/api/health | jq '.status'    # expect "ok"
   pnpm --filter @nidhi/db check                  # confirm nothing else broke
   ```
5. Check whether any pipeline runs were scheduled during the outage and
   missed their window; they will show up as [stale sources](#a-source-has-gone-stale)
   shortly after, which is expected and self-resolves once you catch them up.

**Redis (cache) being down is not this alert.** `/api/health` reports the
cache separately and does not fail the overall `status` for it when the
cache was never required (`isCacheConfigured()` in
`apps/web/src/lib/rate-limit.ts`) — the app degrades to per-instance rate
limiting and a colder read path rather than going down. See
[The API is slow or erroring](#the-api-is-slow-or-erroring) if that is the
actual symptom.
