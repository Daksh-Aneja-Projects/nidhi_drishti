import { NextResponse } from 'next/server';
import { searchEntities } from '@nidhi/db';

/**
 * Typeahead search over ministries and schemes.
 *
 * Internal to the app rather than part of the documented public API, so it is
 * not under /api/v1 and carries no CORS allowance.
 */
export async function GET(request: Request) {
  const term = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (term.length < 2) return NextResponse.json({ results: [] });

  try {
    const results = await searchEntities(term, 12);
    return NextResponse.json(
      { results },
      // Short cache: the underlying index only changes when a pipeline runs.
      { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } },
    );
  } catch {
    // A failed lookup returns an empty result rather than a 500, so a database
    // hiccup degrades the search box instead of breaking the page header.
    return NextResponse.json({ results: [] }, { status: 200 });
  }
}
