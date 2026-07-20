import type { Metadata } from 'next';
import { DigestEditionView } from './edition';
import { istToday, loadDigest, loadDigestDays } from '@/lib/digest';
import { getStrings } from '@/lib/i18n-server';
import { siteUrl } from '@/lib/site';

/**
 * The digest, human-readable counterpart of the feeds (docs/05 A6, docs/07).
 *
 * Today's edition, in Indian time, because an edition is a calendar day here
 * and readers are here. Pure assembly: everything on the page was published
 * elsewhere on this site first, and the digest only gathers it by date.
 *
 * A quiet day is a legitimate outcome. It renders as a quiet day, not as an
 * error and not as a page that failed to load.
 *
 * The page view event is the one the layout already fires through
 * `AnalyticsProvider`; the taxonomy in @nidhi/core is closed and `page_view` is
 * the event that fits, so no new name is invented (docs/09).
 */

export const revalidate = 600;

export async function generateMetadata(): Promise<Metadata> {
  const strings = await getStrings();
  return {
    title: strings.digest.title,
    description: strings.digest.lede,
    alternates: {
      canonical: `${siteUrl}/digest`,
      types: {
        'application/atom+xml': [
          { url: `${siteUrl}/feed.xml`, title: strings.feed.siteTitle },
          { url: `${siteUrl}/feed/flags.xml`, title: strings.feed.flagsTitle },
        ],
      },
    },
  };
}

export default async function DigestPage() {
  const today = istToday();
  const [edition, recentDays] = await Promise.all([loadDigest(today), loadDigestDays(14)]);

  return <DigestEditionView edition={edition} recentDays={recentDays} isToday />;
}
