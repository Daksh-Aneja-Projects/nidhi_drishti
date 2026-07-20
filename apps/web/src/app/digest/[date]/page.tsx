import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DigestEditionView } from '../edition';
import { isDigestDay, istToday, loadDigest, loadDigestDays } from '@/lib/digest';
import { formatIstDate } from '@/lib/format';
import { siteUrl } from '@/lib/site';
import { strings } from '@/lib/strings';

/**
 * One day's edition, at a permanent address.
 *
 * The permalink matters more here than on most pages: a digest is the thing a
 * reader forwards, and a link that shows a different day next week would make
 * the forwarded claim unverifiable.
 *
 * An address that is not a calendar day is a 404 rather than an empty edition.
 * A typo must not read as "nothing was published that day".
 */

export const revalidate = 600;

type Params = Promise<{ date: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { date } = await params;
  if (!isDigestDay(date)) {
    return { title: strings.digest.notFoundTitle };
  }
  return {
    title: `${strings.digest.title}, ${formatIstDate(date)}`,
    description: strings.digest.lede,
    alternates: {
      canonical: `${siteUrl}/digest/${date}`,
      types: {
        'application/atom+xml': [
          { url: `${siteUrl}/feed.xml`, title: strings.feed.siteTitle },
          { url: `${siteUrl}/feed/flags.xml`, title: strings.feed.flagsTitle },
        ],
      },
    },
  };
}

export default async function DigestDatePage({ params }: { params: Params }) {
  const { date } = await params;
  if (!isDigestDay(date)) notFound();

  const [edition, recentDays] = await Promise.all([loadDigest(date), loadDigestDays(14)]);

  return (
    <DigestEditionView
      edition={edition}
      recentDays={recentDays}
      isToday={date === istToday()}
    />
  );
}
