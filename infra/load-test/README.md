# Load tests

Two [k6](https://k6.io) scripts against the public read paths (docs/07 Phase 5).
Both target our own server; neither one touches a government source, so the
docs/08 scraping posture (politeness delay, User-Agent, robots) does not apply
here.

- `read-paths.js` — normal traffic against `/`, `/ministries`,
  `/ministry/[id]`, `/api/v1/national`, `/api/v1/ministries`. Asserts the
  docs/02 target of p95 < 300ms on the two cached JSON aggregate endpoints,
  plus a looser, informational bound on the HTML pages.
- `rate-limit.js` — a burst against one API endpoint, asserting that once the
  per-minute allowance is used up the server answers with 429 rather than
  erroring or timing out.

## Install k6

```bash
# Windows (winget)
winget install k6

# macOS
brew install k6

# Or download a binary: https://k6.io/docs/get-started/installation/
```

## Run against a local server

1. Start Postgres, Redis and the seed data, then the app, in one terminal:

   ```bash
   pnpm bootstrap    # db:up + db:migrate + db:seed, if not already done
   pnpm --filter @nidhi/web build && pnpm --filter @nidhi/web start
   ```

   A dev server (`pnpm dev`) works too but is slower and not representative
   of the p95 numbers below; use a production build for anything you intend
   to compare against the threshold.

2. In a second terminal, from the repo root:

   ```bash
   k6 run infra/load-test/read-paths.js
   k6 run infra/load-test/rate-limit.js
   ```

## Configuration

Both scripts read plain environment variables, so no script edits are needed
for a different target:

| Variable | Default | Meaning |
|---|---|---|
| `BASE_URL` | `http://localhost:3000` | Server under test. |
| `MINISTRY_ID` | `min-agriculture` | Ministry id used for `/ministry/[id]` (`read-paths.js` only). Must exist in the seeded database. |
| `VUS` | `10` | Peak virtual users for the ramping-VUs scenario (`read-paths.js` only). |
| `RATE_LIMIT_PATH` | `/api/v1/national` | Endpoint the burst is aimed at (`rate-limit.js` only). |
| `RATE_LIMIT_RPS` | `20` | Requests per second during the burst (`rate-limit.js` only). Comfortably above `PUBLIC_API_RATE_LIMIT_PER_MINUTE`'s default of 60/min so the bucket empties well inside the 20s run. |

Example, against a non-default port with a higher peak load:

```bash
BASE_URL=http://localhost:3100 VUS=25 k6 run infra/load-test/read-paths.js
```

## Reading the output

- `http_req_duration{endpoint:api_national}` / `...ministries}` — must have
  p(95) under 300ms. A failure here is the docs/02 performance budget
  regressing, not necessarily a bug: check whether Redis was actually up
  (`/api/health`) before assuming the code changed.
- `http_req_failed` — must stay under 1%. Any non-network-error status still
  counts as "not failed" in k6's own metric, which is why `read-paths.js`
  also asserts `checks` (the explicit `status is 200` check per request).
- `rate_limited_responses` (in `rate-limit.js`) — must be greater than zero.
  If it is zero, the burst never actually exceeded the limiter's bucket; the
  run is inconclusive, not a pass. Raise `RATE_LIMIT_RPS` or lower
  `PUBLIC_API_RATE_LIMIT_PER_MINUTE` for the run and try again.
- `unexpected_status_responses` (in `rate-limit.js`) — must stay at zero. A
  count here means the limiter let something through as a 5xx or the process
  stopped responding, which is the actual failure this script exists to catch.

## Never run against a production or third-party deployment

These scripts generate real load. Point `BASE_URL` at a local or staging
instance you control. Running either script against a shared or production
deployment without coordinating first can trip the very rate limiter and
alerting this repo ships (docs/09 section B: "API p95 > 500ms", "error-rate
spike").
