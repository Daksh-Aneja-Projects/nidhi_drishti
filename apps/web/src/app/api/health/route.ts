import { NextResponse } from 'next/server';
import { getSourceFreshness, pingDatabase } from '@nidhi/db';
import { isCacheConfigured, pingCache } from '@/lib/rate-limit';

/**
 * Uptime probe (docs/09 section B): database, cache, and the age of the
 * freshest source.
 *
 * Nothing here leaks a connection string, a hostname or a stack trace. An
 * external monitor gets a status and a per-check breakdown, and an operator
 * reads the logs for the detail.
 *
 * Source staleness is reported but never turns the probe red. Stale government
 * data is a product signal shown on every page; it is not an outage, and paging
 * an on-call engineer because the CGA published late would train them to ignore
 * the alert that matters.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Check {
  ok: boolean;
  detail: string;
  latencyMs?: number;
}

export async function GET(): Promise<NextResponse> {
  const database = await checkDatabase();
  const cache = await checkCache();
  const sources = await checkSources();

  const cacheConfigured = isCacheConfigured();
  const ok = database.ok && (cache.ok || !cacheConfigured);

  return NextResponse.json(
    {
      status: ok ? 'ok' : 'degraded',
      checkedAt: new Date().toISOString(),
      // Freshness is reported at top level too, so an uptime monitor's
      // response-body assertion does not have to reach into `sources`. It
      // never affects `status`: see the note on checkSources below.
      freshestSourceAgeHours: sources.freshestAgeHours,
      // Object form, kept exactly as it already shipped: named lookup for the
      // ops page and anything else reading a specific check by key.
      checks: { database, cache, sources },
      // Array form, additive: a generic uptime/alerting tool (infra/monitoring)
      // can iterate `checkList` without knowing the key names in advance, and
      // assert `checkList.every(c => c.ok)` for anything that must be healthy.
      checkList: [
        { name: 'database', ...database },
        { name: 'cache', ...cache },
        { name: 'sources', ...sources },
      ],
    },
    {
      status: ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

async function checkDatabase(): Promise<Check> {
  const result = await pingDatabase();
  if (result.ok) {
    return { ok: true, detail: 'Reachable.', latencyMs: result.latencyMs };
  }
  // The driver message can carry the host, the port and the user, so it is
  // logged and a fixed string is returned.
  console.error('[health] database unreachable', result.error);
  return { ok: false, detail: 'Unreachable.', latencyMs: result.latencyMs };
}

async function checkCache(): Promise<Check> {
  if (!isCacheConfigured()) {
    return {
      ok: false,
      detail: 'Not configured. The public interface is limited per instance instead.',
    };
  }
  const result = await pingCache();
  return {
    ok: result.ok,
    detail: result.ok ? 'Reachable.' : 'Unreachable. Rate limiting is running per instance.',
    latencyMs: result.latencyMs,
  };
}

async function checkSources(): Promise<
  Check & { freshestAgeHours: number | null; staleCount: number; total: number }
> {
  try {
    const sources = await getSourceFreshness();
    const ages = sources
      .map((source) => source.hoursSinceFetch)
      .filter((hours): hours is number => hours !== null);
    const freshestAgeHours = ages.length > 0 ? Math.min(...ages) : null;
    const staleCount = sources.filter((source) => source.isStale).length;
    return {
      ok: sources.length > 0 && freshestAgeHours !== null,
      detail:
        sources.length === 0
          ? 'No source has been fetched yet.'
          : `${sources.length - staleCount} of ${sources.length} sources are within their expected cadence.`,
      freshestAgeHours,
      staleCount,
      total: sources.length,
    };
  } catch (error) {
    console.error('[health] could not read source freshness', error);
    return {
      ok: false,
      detail: 'Freshness could not be read.',
      freshestAgeHours: null,
      staleCount: 0,
      total: 0,
    };
  }
}
