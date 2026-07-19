import { listMinistrySummaries, type MinistryListOptions } from '@nidhi/db';
import {
  CACHE_SECONDS,
  enforceRateLimit,
  handleApiFailure,
  jsonEnvelope,
  readEnum,
  readLimit,
  resolveApiFy,
} from '@/lib/api';

/**
 * GET /api/v1/ministries?fy=FY2026&sector=&order=&limit=
 *
 * Every ministry with its authority, its expenditure to date and its pace.
 * Figures the source does not publish come back as null, which is not zero.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ORDERS = ['allocation', 'burn_asc', 'burn_desc', 'name', 'balance'] as const;

export async function GET(request: Request) {
  try {
    const limited = await enforceRateLimit(request);
    if (limited.response) return limited.response;

    const url = new URL(request.url);
    const fy = await resolveApiFy(url);
    const options: MinistryListOptions = {
      sector: url.searchParams.get('sector') ?? undefined,
      orderBy: readEnum(url, 'order', ORDERS),
      limit: readLimit(url, 200, 500),
    };

    const ministries = await listMinistrySummaries(fy, options);

    return await jsonEnvelope({ ministries, count: ministries.length }, fy, {
      sMaxAge: CACHE_SECONDS.fiscal,
      headers: limited.headers,
    });
  } catch (error) {
    return handleApiFailure(error, 'GET /ministries');
  }
}
