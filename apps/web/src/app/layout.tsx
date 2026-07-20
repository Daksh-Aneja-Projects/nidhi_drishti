import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import { AnalyticsProvider } from '@/components/analytics-provider';
import { FreshnessBar } from '@/components/freshness-bar';
import { DataModeBanner, SiteFooter, SiteHeader } from '@/components/site-chrome';
import { fontVariables } from '@/lib/fonts';
import { loadChrome, siteUrl } from '@/lib/site';
import { strings } from '@/lib/strings';
import './globals.css';

export const metadata: Metadata = {
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
  // Feed autodiscovery, site-wide rather than per page: a reader who wants the
  // feed is as likely to be on a ministry page as on the digest, and one
  // declaration in the document head is what every feed reader looks for.
  alternates: {
    types: {
      'application/atom+xml': [
        { url: '/feed.xml', title: strings.feed.siteTitle },
        { url: '/feed/flags.xml', title: strings.feed.flagsTitle },
      ],
    },
  },
};

export const viewport: Viewport = {
  themeColor: '#eff1ee',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The chrome needs the year and the freshness on every page, so both are
  // resolved once here rather than repeated in each route.
  const { fy, available, dataMode, freshness } = await loadChrome();

  return (
    <html lang="en-IN" className={fontVariables}>
      <body className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-[color:var(--color-paper-raised)] focus:px-3 focus:py-2"
        >
          Skip to content
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
      </body>
    </html>
  );
}
