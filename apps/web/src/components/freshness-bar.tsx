import { AlertTriangle } from 'lucide-react';
import type { SourceFreshness } from '@nidhi/core';
import { Icon } from '@/components/icon';
import { formatAge, formatIstDateShort } from '@/lib/format';
import { getLocale, getStrings } from '@/lib/i18n-server';
import { type Locale } from '@/lib/i18n';

/**
 * Per-source freshness, on every page (docs/06 global elements).
 *
 * Government sources go down, change format and lag, so freshness is a
 * first-class part of the reading rather than a footnote. Each chip carries the
 * date the newest document *claims* and how long since we last fetched
 * successfully, because those are different questions and readers need both:
 * a source fetched an hour ago can still be publishing two-month-old accounts.
 */

export async function FreshnessBar({ sources }: { sources: SourceFreshness[] }) {
  // Tier 1 carries the fiscal facts. Tier 2 is corroborating signal, and
  // crowding the bar with it would bury the figures that matter.
  const primary = sources.filter((source) => source.tier === 1);
  if (primary.length === 0) return null;

  const [strings, locale] = await Promise.all([getStrings(), getLocale()]);

  return (
    <div className="border-b border-[color:var(--color-rule)] bg-[color:var(--color-paper-sunk)]">
      <div className="mx-auto flex max-w-[90rem] flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-2 sm:px-6">
        <span className="eyebrow">{strings.freshness.title}</span>
        {primary.map((source) => (
          <FreshnessChip key={source.sourceId} source={source} strings={strings} locale={locale} />
        ))}
      </div>
    </div>
  );
}

function FreshnessChip({
  source,
  strings,
  locale,
}: {
  source: SourceFreshness;
  strings: Awaited<ReturnType<typeof getStrings>>;
  locale: Locale;
}) {
  const documentDate = source.latestDocumentDate
    ? formatIstDateShort(source.latestDocumentDate, locale)
    : null;

  return (
    <span className="flex items-baseline gap-1.5 text-xs">
      {source.isStale ? (
        <Icon
          icon={AlertTriangle}
          size="xs"
          className="translate-y-px text-[color:var(--color-seal)]"
          label={strings.freshness.stale}
        />
      ) : null}
      <span className="text-[color:var(--color-ink-soft)]">{source.name}</span>
      <span className="figure text-[color:var(--color-ink)]">
        {documentDate ?? strings.freshness.never}
      </span>
      <span className="text-[color:var(--color-ink-faint)]">
        {source.lastFetchedAt ? `· ${formatAge(source.hoursSinceFetch, locale)}` : ''}
      </span>
    </span>
  );
}
