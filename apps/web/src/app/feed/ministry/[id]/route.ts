import { getMinistrySummary } from '@nidhi/db';
import {
  evidenceToFeedEntry,
  feedHeaders,
  feedId,
  flagToFeedEntry,
  renderAtom,
  type FeedEntry,
} from '@/lib/feed';
import { loadFeedMaterial } from '@/lib/digest';
import { resolveFy, siteUrl } from '@/lib/site';
import { strings } from '@/lib/strings';

/**
 * GET /feed/ministry/<ministry-id>.xml
 *
 * One ministry's feed, covering the ministry itself and the schemes that sit
 * under it, because a reader following a ministry means its programmes too.
 *
 * The route segment is `[id]` rather than `[id].xml`: Next treats a segment as
 * dynamic only when the brackets span the whole segment, so `[id].xml` would be
 * matched as a literal path. The `.xml` suffix is therefore stripped from the
 * parameter here, which keeps the published address the one a feed reader
 * expects while leaving the routing unambiguous.
 *
 * Approved signals only, on the same two independent gates as the other feeds.
 */

export const runtime = 'nodejs';
export const revalidate = 600;

function stripXmlSuffix(id: string): string {
  return id.endsWith('.xml') ? id.slice(0, -4) : id;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const ministryId = stripXmlSuffix(decodeURIComponent(id));

  const { flags, evidence } = await loadFeedMaterial({ ministryId, limit: 30 });

  // The name is for the feed title only. A ministry with no figures in the
  // current year is still a ministry, so the lookup failing is not fatal; an
  // address with neither a ministry nor any published content behind it is.
  let ministryName: string | null = null;
  try {
    const { fy } = await resolveFy();
    ministryName = (await getMinistrySummary(fy, ministryId))?.name ?? null;
  } catch (error) {
    console.error('[feed] could not read the ministry name', error);
  }

  if (ministryName === null && flags.length === 0 && evidence.length === 0) {
    return new Response(null, { status: 404 });
  }

  const entries: FeedEntry[] = [
    ...flags.map((flag) => flagToFeedEntry(flag, siteUrl)),
    ...evidence.map((item) => evidenceToFeedEntry(item, siteUrl)),
  ]
    .filter((entry): entry is FeedEntry => entry !== null)
    .sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime())
    .slice(0, 50);

  const xml = renderAtom({
    // Keyed on the ministry id, not on the URL, so the feed keeps its identity
    // across a domain change exactly as its entries do.
    id: feedId(`ministry:${ministryId}`),
    title: ministryName
      ? `${ministryName}, ${strings.feed.ministrySuffix}`
      : strings.feed.ministryUnknownTitle,
    subtitle: strings.feed.ministrySubtitle,
    selfUrl: `${siteUrl}/feed/ministry/${encodeURIComponent(ministryId)}.xml`,
    alternateUrl: `${siteUrl}/ministry/${encodeURIComponent(ministryId)}`,
    entries,
  });

  return new Response(xml, { status: 200, headers: feedHeaders() });
}
