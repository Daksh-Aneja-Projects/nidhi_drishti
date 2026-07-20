import {
  evidenceToFeedEntry,
  feedHeaders,
  feedId,
  flagToFeedEntry,
  renderAtom,
  type FeedEntry,
} from '@/lib/feed';
import { loadFeedMaterial } from '@/lib/digest';
import { siteUrl } from '@/lib/site';
import { strings } from '@/lib/strings';

/**
 * GET /feed.xml
 *
 * The site-wide feed: everything the digest publishes, in one chronology.
 * Signals that cleared review, and evidence that carries a written summary.
 *
 * Nothing unreviewed can reach this document. `listPublishedFlags` writes
 * `status = 'approved'` into the SQL as a literal with no parameter, and
 * `flagToFeedEntry` refuses to build an entry for anything else, so both the
 * query and the serialiser would have to be changed for a pending signal to be
 * published (docs/05 A3).
 */

export const runtime = 'nodejs';
export const revalidate = 600;

export async function GET(): Promise<Response> {
  const { flags, evidence } = await loadFeedMaterial({ limit: 30 });

  const entries: FeedEntry[] = [
    ...flags.map((flag) => flagToFeedEntry(flag, siteUrl)),
    ...evidence.map((item) => evidenceToFeedEntry(item, siteUrl)),
  ]
    .filter((entry): entry is FeedEntry => entry !== null)
    // One chronology rather than two blocks: a reader sees the day as it
    // happened, not signals first and context afterwards.
    .sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime())
    .slice(0, 50);

  const xml = renderAtom({
    id: feedId('site'),
    title: strings.feed.siteTitle,
    subtitle: `${strings.feed.siteSubtitle} ${strings.site.description}`,
    selfUrl: `${siteUrl}/feed.xml`,
    alternateUrl: `${siteUrl}/digest`,
    entries,
  });

  return new Response(xml, { status: 200, headers: feedHeaders() });
}
