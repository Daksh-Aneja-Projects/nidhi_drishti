import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

/**
 * Public pages are meant to be indexed: a citizen searching for a ministry's
 * spending should be able to find the page (docs/02). The internal surfaces are
 * not, and the search endpoint is a typeahead rather than a document.
 */

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/admin/', '/ops', '/api/search'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
