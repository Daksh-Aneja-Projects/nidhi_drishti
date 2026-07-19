import { listSchemeSummaries, type SchemeListOptions } from '@nidhi/db';
import type { SchemeType } from '@nidhi/core';
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
 * GET /api/v1/schemes?fy=FY2026&ministry=&type=&order=&limit=
 *
 * Allocation, releases and utilisation are three separate stages of the same
 * rupee and are returned as three separate fields. Utilisation coverage is
 * partial by nature (docs/03 limitation 2), so null is common and means the
 * figure is not published rather than that nothing was spent.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ORDERS = ['allocation', 'utilization_asc', 'name'] as const;
const TYPES = ['CSS', 'CS', 'other'] as const satisfies readonly SchemeType[];

export async function GET(request: Request) {
  try {
    const limited = await enforceRateLimit(request);
    if (limited.response) return limited.response;

    const url = new URL(request.url);
    const fy = await resolveApiFy(url);
    const options: SchemeListOptions = {
      ministryId: url.searchParams.get('ministry') ?? undefined,
      schemeType: readEnum(url, 'type', TYPES),
      orderBy: readEnum(url, 'order', ORDERS),
      limit: readLimit(url, 200, 300),
    };

    const schemes = await listSchemeSummaries(fy, options);

    return await jsonEnvelope({ schemes, count: schemes.length }, fy, {
      sMaxAge: CACHE_SECONDS.fiscal,
      headers: limited.headers,
    });
  } catch (error) {
    return handleApiFailure(error, 'GET /schemes');
  }
}
