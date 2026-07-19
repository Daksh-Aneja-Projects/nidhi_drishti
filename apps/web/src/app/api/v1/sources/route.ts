import { getSourceFreshness, listSourceRegistry } from '@nidhi/db';
import {
  CACHE_SECONDS,
  enforceRateLimit,
  handleApiFailure,
  jsonEnvelope,
  resolveApiFy,
} from '@/lib/api';

/**
 * GET /api/v1/sources
 *
 * The attribution list docs/08 requires, in machine-readable form: every source
 * with its tier, cadence, access method, licence note and current freshness.
 * Anyone republishing figures from this interface needs this to attribute them.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const limited = await enforceRateLimit(request);
    if (limited.response) return limited.response;

    const fy = await resolveApiFy(new URL(request.url));
    const [registry, freshness] = await Promise.all([listSourceRegistry(), getSourceFreshness()]);
    const freshnessById = new Map(freshness.map((entry) => [entry.sourceId, entry]));

    const sources = registry.map((entry) => ({
      ...entry,
      freshness: freshnessById.get(entry.sourceId) ?? null,
    }));

    return await jsonEnvelope({ sources, count: sources.length }, fy, {
      sMaxAge: CACHE_SECONDS.operational,
      headers: limited.headers,
    });
  } catch (error) {
    return handleApiFailure(error, 'GET /sources');
  }
}
