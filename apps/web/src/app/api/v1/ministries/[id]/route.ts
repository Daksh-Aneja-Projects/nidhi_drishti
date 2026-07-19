import {
  getMinistrySummary,
  getMonthlySpend,
  listFlags,
  listSchemeSummaries,
} from '@nidhi/db';
import {
  ApiFailure,
  CACHE_SECONDS,
  enforceRateLimit,
  handleApiFailure,
  jsonEnvelope,
  resolveApiFy,
} from '@/lib/api';

/**
 * GET /api/v1/ministries/{id}?fy=FY2026
 *
 * One ministry with its monthly series, its schemes and the reviewed signals
 * raised against it. Unknown ministry is a 404; a known ministry with no
 * figures for the year requested is not.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const limited = await enforceRateLimit(request);
    if (limited.response) return limited.response;

    // Next 15 hands route params over as a promise.
    const { id } = await context.params;
    const fy = await resolveApiFy(new URL(request.url));

    const summary = await getMinistrySummary(fy, id);
    if (!summary) {
      throw new ApiFailure(404, 'not_found', `No ministry is recorded with the id "${id}".`);
    }

    const [monthly, schemes, flags] = await Promise.all([
      getMonthlySpend('ministry', id, fy),
      listSchemeSummaries(fy, { ministryId: id, limit: 100 }),
      // Public feed: approved signals only, which is the default of listFlags.
      listFlags({ fy, entityType: 'ministry', entityId: id, limit: 50 }),
    ]);

    return await jsonEnvelope({ ministry: summary, monthly, schemes, flags }, fy, {
      sMaxAge: CACHE_SECONDS.fiscal,
      headers: limited.headers,
    });
  } catch (error) {
    return handleApiFailure(error, 'GET /ministries/{id}');
  }
}
