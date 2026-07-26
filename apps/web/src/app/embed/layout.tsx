import type { Metadata } from 'next';

/**
 * The embed segment (docs/07, the newsroom embeds line).
 *
 * Chrome-free by design: the root layout detects the `/embed` path and renders
 * no header, no search, no freshness bar and no footer, so what an article
 * iframes is the card and nothing else. This layout's job is the metadata: an
 * embed is a fragment of another page's story and must never be indexed as a
 * page of ours, so the robots directive here overrides the site-wide index
 * rule for everything under `/embed`.
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
