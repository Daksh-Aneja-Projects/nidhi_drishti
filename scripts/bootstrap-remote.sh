#!/usr/bin/env bash
#
# Take an empty managed Postgres to a working deployment.
#
#   DATABASE_URL='postgres://...' ./scripts/bootstrap-remote.sh
#
# Runs the migrations, seeds the reference data, ingests the Union Budget from
# indiabudget.gov.in, and refreshes the materialised views. Safe to re-run: the
# migrations are checksummed and forward-only, the seeds are ON CONFLICT DO
# NOTHING, and the fact upserts are idempotent on their natural key.
#
# It reads the live budget from a government server, so it obeys the same
# politeness rules as every other run: robots consulted, two seconds between
# requests, and an honest From header. Do not run it in a loop.

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required. Paste the connection string from your Postgres host." >&2
  exit 1
fi

# A managed host will refuse an unencrypted connection; most append this
# themselves, but a pasted string sometimes lacks it.
case "$DATABASE_URL" in
  *sslmode=*) ;;
  *\?*) export DATABASE_URL="${DATABASE_URL}&sslmode=require" ;;
  *)    export DATABASE_URL="${DATABASE_URL}?sslmode=require" ;;
esac

echo "==> 1/4  Applying migrations"
pnpm db:migrate

echo "==> 2/4  Seeding reference data (fiscal years, ministries, schemes, sources)"
pnpm db:seed

echo "==> 3/4  Ingesting the Union Budget from indiabudget.gov.in"
# The one source that needs no key and carries the figures the whole site is
# built around: 69 ministries across four stages, plus the national totals.
uv run python -m pipelines run union_budget

echo "==> 4/4  Refreshing materialised views"
pnpm db:refresh

echo
echo "Done. Point the web app at this DATABASE_URL with DATA_MODE=live."
echo "Check it served something real:"
echo "  psql \"\$DATABASE_URL\" -c \"SELECT fy, stage, count(*) FROM fiscal_fact GROUP BY 1,2 ORDER BY 1,2;\""
