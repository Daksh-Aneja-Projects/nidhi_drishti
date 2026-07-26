import type { MetadataRoute } from 'next';
import { listMinistrySummaries, listSchemeSummaries, listStates } from '@nidhi/db';
import { resolveFy, siteUrl } from '@/lib/site';

/**
 * Public pages, including one entry per ministry and scheme.
 *
 * Tolerates the database being unreachable: a build in continuous integration
 * has no database, and a sitemap listing only the static pages is better than a
 * failed build. Internal surfaces are excluded here as well as in robots.
 */

export const revalidate = 3600;

const STATIC_PATHS = [
  '/',
  '/ministries',
  '/schemes',
  '/states',
  '/flags',
  '/compare',
  '/methodology',
  '/sources',
  '/corrections',
  '/api-docs',
  '/digest',
];

/**
 * The feeds are listed too.
 *
 * A feed is a document at a stable address, not an asset, and listing it is how
 * a crawler learns the site publishes one. Dated digest editions are
 * deliberately not enumerated: there is one per day for the life of the
 * project, and the feeds plus the "earlier editions" list already reach them.
 */
const FEED_PATHS = ['/feed.xml', '/feed/flags.xml'];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: `${siteUrl}${path}`,
    lastModified,
    changeFrequency: path === '/' ? 'daily' : 'weekly',
    priority: path === '/' ? 1 : 0.7,
  }));

  for (const path of FEED_PATHS) {
    entries.push({
      url: `${siteUrl}${path}`,
      lastModified,
      changeFrequency: 'daily',
      priority: 0.5,
    });
  }

  try {
    const { fy } = await resolveFy();
    const [ministries, schemes, states] = await Promise.all([
      listMinistrySummaries(fy, { limit: 500 }),
      listSchemeSummaries(fy, { limit: 300 }),
      listStates(),
    ]);
    for (const ministry of ministries) {
      entries.push({
        url: `${siteUrl}/ministry/${encodeURIComponent(ministry.ministryId)}`,
        lastModified,
        changeFrequency: 'weekly',
        priority: 0.8,
      });
    }
    for (const scheme of schemes) {
      entries.push({
        url: `${siteUrl}/scheme/${encodeURIComponent(scheme.schemeId)}`,
        lastModified,
        changeFrequency: 'weekly',
        priority: 0.6,
      });
    }
    // Every state page exists, ingested or not: an empty state page states
    // plainly what is missing, which is itself part of the public record. The
    // embed routes are deliberately absent; they are noindex fragments.
    for (const state of states) {
      entries.push({
        url: `${siteUrl}/state/${encodeURIComponent(state.stateId)}`,
        lastModified,
        changeFrequency: 'weekly',
        priority: 0.6,
      });
    }
  } catch (error) {
    console.error('[sitemap] could not list entities, serving the static pages only', error);
  }

  return entries;
}
