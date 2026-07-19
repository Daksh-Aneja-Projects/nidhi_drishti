import { getSchemeSummary, listEvidence, listFlags, listTenders } from '@nidhi/db';
import {
  ApiFailure,
  CACHE_SECONDS,
  enforceRateLimit,
  handleApiFailure,
  jsonEnvelope,
  resolveApiFy,
} from '@/lib/api';

/**
 * GET /api/v1/schemes/{id}?fy=FY2026
 *
 * One scheme with the observable activity around it: matched tenders, press
 * and parliament evidence, and reviewed signals. Tender matching is name based
 * and imperfect, and each tender carries the confidence of its match.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const limited = await enforceRateLimit(request);
    if (limited.response) return limited.response;

    const { id } = await context.params;
    const fy = await resolveApiFy(new URL(request.url));

    const summary = await getSchemeSummary(fy, id);
    if (!summary) {
      throw new ApiFailure(404, 'not_found', `No scheme is recorded with the id "${id}".`);
    }

    const [tenders, evidence, flags] = await Promise.all([
      listTenders({ schemeId: id, limit: 50 }),
      listEvidence({ schemeId: id, limit: 25 }),
      listFlags({ fy, entityType: 'scheme', entityId: id, limit: 50 }),
    ]);

    return await jsonEnvelope({ scheme: summary, tenders, evidence, flags }, fy, {
      sMaxAge: CACHE_SECONDS.fiscal,
      headers: limited.headers,
    });
  } catch (error) {
    return handleApiFailure(error, 'GET /schemes/{id}');
  }
}
