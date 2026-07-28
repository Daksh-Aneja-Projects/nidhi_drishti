# Deploying

Two routes. Pick by whether you want to run a machine.

| | Self-hosted | Managed |
|---|---|---|
| Web app | Docker on one VPS | Vercel |
| Database | Postgres in the same stack | Neon, Supabase, RDS |
| Artifact store | MinIO in the same stack | S3, R2, Spaces |
| Pipelines | cron on the same box | any machine that can reach the database |
| Roughly | one box, one command | no machine, more accounts |

Both need the same three things before anything is deployed: a domain, somewhere
for Postgres to live, and a contact address to put in the scraper's User-Agent.

---

## Route A: self-hosted, one machine

Requirements: a Linux host with Docker and about 4 GB of RAM, a domain pointed at
it, and something terminating TLS in front (Caddy is two lines of config).

```bash
git clone https://github.com/Daksh-Aneja-Projects/nidhi_drishti.git
cd nidhi_drishti
cp .env.production.example .env.production
```

Fill in `.env.production`. Every value marked REQUIRED has no default and the
stack refuses to start without it. Then:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d --build
```

That builds the web image, starts Postgres, Redis and MinIO, runs the migrations
and the reference seed as a one-shot, and starts the app on `WEB_PORT`. Postgres,
Redis and MinIO bind to loopback only; the app's port is the only one meant to be
reachable, and it should be reachable only through your TLS terminator.

Check it:

```bash
curl -s localhost:3000/api/health | jq
```

`status: "ok"` means the app is up and the database is reachable. Anything else
names what is wrong in `checkList`.

At this point the site is running and, in `live` mode, showing "Not yet fetched"
everywhere. It has no figures until a pipeline puts some there. That is the next
section, and it is the part that needs a person rather than a command.

### Running pipelines

One invocation per source, from the host's cron:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env.production \
  --profile tools run --rm pipelines -m pipelines run cga_monthly
```

A non-zero exit code means the run failed or drifted. Do not treat a drift alert
as success: it means the source changed shape and the pipeline deliberately
wrote nothing rather than writing something plausible and wrong.

Cadences that match how the sources actually publish:

| Source | When | Note |
|---|---|---|
| `cga_monthly` | monthly, after the last working day | the spend denominator |
| `union_budget` | February, and after each supplementary | the allocation numerator |
| `ogd_datasets` | weekly | needs `OGD_API_KEY` |
| `pib_releases` | daily | verification evidence |
| `cppp_tenders` | daily | verification evidence |
| `sansad_qa` | during sessions | utilisation gold |

### Sources that refuse automated access

Several portals block automated clients outright. We do not work around that.
The route for those is a person downloading the document and dropping it in
`data/intake/<source_id>/` with a manifest: see [data/intake/README.md](../data/intake/README.md).
The compose file mounts that directory into the pipelines container read-only,
so a drop on the host is ingestable immediately:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env.production \
  --profile tools run --rm pipelines -m pipelines run union_budget --from-intake
```

Figures obtained this way are published with the retrieval stated on the figure
itself, so nobody mistakes a hand-refreshed number for a scheduled one.

### Backups

Two things are worth backing up, for different reasons.

```bash
# The database: rebuildable from the artifacts, but slowly.
docker compose -f infra/docker-compose.prod.yml exec postgres \
  pg_dump -U nidhi nidhi | gzip > nidhi-$(date +%F).sql.gz

# The artifact bucket: NOT rebuildable. Government portals replace documents in
# place and take them down. This is the evidence behind every published figure.
docker run --rm -v nidhi-drishti-prod_minio_data:/data -v "$PWD":/backup \
  alpine tar czf /backup/artifacts-$(date +%F).tar.gz /data
```

---

## Route B: managed

Vercel for the app, a managed Postgres, an S3-compatible bucket.

1. **Database.** Create a Postgres 16 instance with the `vector` extension
   available (Neon and Supabase both have it). Take its connection string.

2. **Migrate.** From a checkout, pointed at the managed database:

   ```bash
   DATABASE_URL='postgres://...' pnpm --filter @nidhi/db migrate
   DATABASE_URL='postgres://...' pnpm --filter @nidhi/db seed
   ```

   Migrations are forward-only and checksummed, so this is safe to repeat on
   every deploy and is a no-op when nothing has changed.

3. **Web app.** Import the repository into Vercel. Root directory `apps/web`,
   build command `pnpm --filter @nidhi/web build`, install `pnpm install`.
   Environment: `DATABASE_URL`, `NEXT_PUBLIC_SITE_URL`, `DATA_MODE=live`, and
   optionally `REDIS_URL`, `SENTRY_DSN`, `ADMIN_REVIEW_TOKEN`.

   `NEXT_PUBLIC_*` values are compiled into the client bundle, so changing the
   site URL needs a redeploy, not a restart.

4. **Artifact store.** An S3 bucket, versioning on, private. Set `S3_ENDPOINT`,
   `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` wherever the pipelines run. The
   web app never touches the bucket; only the pipelines write to it.

5. **Pipelines.** They are not serverless work: a budget PDF parse runs for
   minutes and a polite crawl deliberately waits between requests. Run them from
   the pipelines image on any machine that can reach the database, on cron.

---

## Route C: free, for a public demo

Enough to put a working link in front of people. Two free accounts, no card.

**Postgres.** Create a project on Neon (neon.tech) or Supabase. Copy the
connection string. The whole database is a few hundred rows, so the free tier is
not close to a constraint.

**Seed it**, from this repo on your machine:

```bash
DATABASE_URL='postgres://...' ./scripts/bootstrap-remote.sh
```

That migrates, seeds the reference data, ingests the Union Budget from
indiabudget.gov.in and refreshes the views. It reads a government server, so it
obeys the same politeness rules as any other run.

**The web app.** Import the repo on Vercel and set **Root Directory** to
`apps/web`. Leave the build and install commands on their defaults: Vercel
detects the pnpm workspace, installs from the repository root, and finds Next.js
in the app's own package.json. `next.config.ts` already carries the two settings
a monorepo deploy needs, `transpilePackages` for the workspace packages and
`outputFileTracingRoot` pointing at the repo root.

Do not add a `vercel.json` that overrides the build from the repository root.
With the root directory set there, Vercel looks for Next.js in the root
package.json, does not find it, and fails detection before the build starts.

The only thing to add is the environment:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the connection string, with `sslmode=require` |
| `DATA_MODE` | `live` |
| `NEXT_PUBLIC_SITE_URL` | the deployed URL |
| `SCRAPER_CONTACT` | an address you read |

Nothing else is required at runtime. The app reads Postgres and nothing else:
object storage holds the raw artifacts for reprocessing and audit, and Redis is
only used for API rate limiting, so both are optional for a demo.

**What a visitor will see.** The national and ministry figures are real and
current. The scheme, signal and state pages are honest empty states, because
those sources are not ingested yet. The freshness bar says so on every page,
which is the product working, not a gap to hide. Say so in the post rather than
letting someone find it.

## Before making it public

- [ ] `DATA_MODE=live`. In any other mode the site publishes sample figures, and
      says so in a banner, but says it to the whole internet.
- [ ] `SCRAPER_USER_AGENT` carries an address you actually read.
- [ ] `ADMIN_REVIEW_TOKEN` is set to something random. Without it the anomaly
      review queue is open.
- [ ] TLS terminates in front of the app; nothing else is exposed.
- [ ] `/api/health` returns `ok`.
- [ ] A backup of the artifact bucket has run once, successfully.
- [ ] The disclaimer and the non-affiliation notice are visible on every page.
      They are part of the layout, so this is a check that you have not removed
      them, not a thing to add.
- [ ] At least one pipeline has run and the figures on the front page trace to a
      real document through the provenance popover. A site with no figures is
      honest; a site with figures and no provenance is not.
