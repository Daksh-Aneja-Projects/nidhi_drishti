import { getMonthlySpend, getNationalSummary } from '@nidhi/db';
import {
  CACHE_SECONDS,
  NATIONAL_ENTITY_ID,
  enforceRateLimit,
  handleApiFailure,
  jsonEnvelope,
  resolveApiFy,
} from '@/lib/api';

/**
 * GET /api/v1/national?fy=FY2026
 *
 * The national headline plus the de-cumulated monthly series. A financial year
 * with nothing ingested returns a null summary and an empty series rather than
 * a 404: the year exists, the figures for it have not been published yet.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const limited = await enforceRateLimit(request);
    if (limited.response) return limited.response;

    const fy = await resolveApiFy(new URL(request.url));
    const [summary, monthly] = await Promise.all([
      getNationalSummary(fy),
      getMonthlySpend('national', NATIONAL_ENTITY_ID, fy),
    ]);

    return await jsonEnvelope({ summary, monthly }, fy, {
      sMaxAge: CACHE_SECONDS.fiscal,
      headers: limited.headers,
    });
  } catch (error) {
    return handleApiFailure(error, 'GET /national');
  }
}
