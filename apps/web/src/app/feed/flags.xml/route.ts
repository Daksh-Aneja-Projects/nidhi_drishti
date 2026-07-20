import {
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
 * GET /feed/flags.xml
 *
 * Signals only, for readers who want the reviewed findings and not the
 * surrounding activity. Approved signals only, guaranteed twice: by the query,
 * which has no parameter for status, and by `flagToFeedEntry`, which returns
 * null for anything that is not approved (docs/05 A3).
 *
 * Every entry carries the rule's "what this does not establish" line, read out
 * of ANOMALY_RULES by the serialiser rather than passed in, so a republished
 * entry cannot lose the caveat.
 */

export const runtime = 'nodejs';
export const revalidate = 600;

export async function GET(): Promise<Response> {
  const { flags } = await loadFeedMaterial({ limit: 50 });

  const entries: FeedEntry[] = flags
    .map((flag) => flagToFeedEntry(flag, siteUrl))
    .filter((entry): entry is FeedEntry => entry !== null);

  const xml = renderAtom({
    id: feedId('flags'),
    title: strings.feed.flagsTitle,
    subtitle: strings.feed.flagsSubtitle,
    selfUrl: `${siteUrl}/feed/flags.xml`,
    alternateUrl: `${siteUrl}/flags`,
    entries,
  });

  return new Response(xml, { status: 200, headers: feedHeaders() });
}
