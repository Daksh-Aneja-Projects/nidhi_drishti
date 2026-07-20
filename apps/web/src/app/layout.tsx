import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import { AnalyticsProvider } from '@/components/analytics-provider';
import { FreshnessBar } from '@/components/freshness-bar';
import { LocaleProvider } from '@/components/locale-provider';
import { DataModeBanner, SiteFooter, SiteHeader } from '@/components/site-chrome';
import { fontVariables } from '@/lib/fonts';
import { HTML_LANG, localePath } from '@/lib/i18n';
import { getCanonicalPath, getLocale, getStrings } from '@/lib/i18n-server';
import { loadChrome, siteUrl } from '@/lib/site';
import './globals.css';

/**
 * Metadata is generated per request so the title and description carry the
 * active language, and so every page advertises its counterpart. The `hreflang`
 * alternates point English and Hindi at each other (plus `x-default` on the
 * English URL), which is how a crawler finds the Hindi pages: one URL maps to
 * one language, and the pair is declared in the head.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [strings, locale, canonicalPath] = await Promise.all([
    getStrings(),
    getLocale(),
    getCanonicalPath(),
  ]);
  const enUrl = canonicalPath;
  const hiUrl = localePath(canonicalPath, 'hi');

  return {
    metadataBase: new URL(siteUrl),
    title: {
      default: `${strings.site.name} · ${strings.site.tagline}`,
      template: `%s · ${strings.site.name}`,
    },
    description: strings.site.description,
    openGraph: {
      type: 'website',
      siteName: strings.site.name,
      title: strings.site.name,
      description: strings.site.description,
    },
    robots: { index: true, follow: true },
    alternates: {
      canonical: locale === 'hi' ? hiUrl : enUrl,
      languages: {
        'en-IN': enUrl,
        'hi-IN': hiUrl,
        'x-default': enUrl,
      },
      // Feed autodiscovery, site-wide rather than per page: a reader who wants
      // the feed is as likely to be on a ministry page as on the digest, and one
      // declaration in the document head is what every feed reader looks for.
      types: {
        'application/atom+xml': [
          { url: '/feed.xml', title: strings.feed.siteTitle },
          { url: '/feed/flags.xml', title: strings.feed.flagsTitle },
        ],
      },
    },
  };
}

export const viewport: Viewport = {
  themeColor: '#eff1ee',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The chrome needs the year and the freshness on every page, so both are
  // resolved once here rather than repeated in each route. The locale is decided
  // by the middleware before render, so the document sets its language on the
  // server with no flash of English.
  const [{ fy, available, dataMode, freshness }, locale, strings] = await Promise.all([
    loadChrome(),
    getLocale(),
    getStrings(),
  ]);

  return (
    <html lang={HTML_LANG[locale]} className={fontVariables}>
      <body className="flex min-h-screen flex-col">
        <LocaleProvider locale={locale}>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-[color:var(--color-paper-raised)] focus:px-3 focus:py-2"
          >
            {strings.a11y.skipToContent}
          </a>

          <DataModeBanner mode={dataMode} />
          <Suspense fallback={null}>
            <SiteHeader fy={fy} availableFy={available} />
          </Suspense>
          <FreshnessBar sources={freshness} />

          <main id="main" className="flex-1">
            {children}
          </main>

          <SiteFooter />

          <Suspense fallback={null}>
            <AnalyticsProvider fy={fy} />
          </Suspense>
        </LocaleProvider>
      </body>
    </html>
  );
}
