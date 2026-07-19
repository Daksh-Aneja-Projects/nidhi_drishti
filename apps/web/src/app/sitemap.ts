import type { MetadataRoute } from 'next';
import { listMinistrySummaries, listSchemeSummaries } from '@nidhi/db';
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
  '/flags',
  '/compare',
  '/methodology',
  '/sources',
  '/corrections',
  '/api-docs',
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: `${siteUrl}${path}`,
    lastModified,
    changeFrequency: path === '/' ? 'daily' : 'weekly',
    priority: path === '/' ? 1 : 0.7,
  }));

  try {
    const { fy } = await resolveFy();
    const [ministries, schemes] = await Promise.all([
      listMinistrySummaries(fy, { limit: 500 }),
      listSchemeSummaries(fy, { limit: 300 }),
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
  } catch (error) {
    console.error('[sitemap] could not list entities, serving the static pages only', error);
  }

  return entries;
}
