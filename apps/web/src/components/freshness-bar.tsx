import Link from 'next/link';
import type { SourceFreshness } from '@nidhi/core';
import { formatAge, formatIstDateShort } from '@/lib/format';
import { getLocale, getStrings } from '@/lib/i18n-server';
import { type Locale } from '@/lib/i18n';

/**
 * Per-source freshness, on every page (docs/06 global elements).
 *
 * Government sources go down, change format and lag, so freshness is a
 * first-class part of the reading rather than a footnote.
 *
 * It is a summary, not a roll call. Naming every Tier 1 source inline put
 * thirteen entries across the top of every page, and on a deployment where
 * most are not yet ingested that is eleven identical warnings shouting above
 * the figures they are meant to qualify. What a reader needs at a glance is
 * how much of the picture is current; which particular source is overdue is a
 * question for the sources page, and the count links straight to it.
 *
 * The reporting sources are named, because those are the ones the figures on
 * the screen actually came from.
 */

export async function FreshnessBar({ sources }: { sources: SourceFreshness[] }) {
  // Tier 1 carries the fiscal facts. Tier 2 is corroborating signal, and
  // crowding the bar with it would bury the figures that matter.
  const primary = sources.filter((source) => source.tier === 1);
  if (primary.length === 0) return null;

  const [strings, locale] = await Promise.all([getStrings(), getLocale()]);

  const reporting = primary.filter((source) => source.lastFetchedAt !== null);
  const current = reporting.filter((source) => !source.isStale);
  const newest = primary
    .map((source) => source.latestDocumentDate)
    .filter((date): date is string => date !== null)
    .sort()
    .at(-1);

  return (
    // Still the binding: freshness qualifies the document rather than being
    // part of it, so it stays on the cloth, one shade deeper than the header.
    <div className="cloth" style={{ backgroundColor: 'var(--color-cloth-deep)' }}>
      <div className="mx-auto flex max-w-[90rem] flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2 text-xs text-[color:var(--color-on-cloth-faint)] sm:px-6">
        <span className="eyebrow text-[color:var(--color-brass-soft)]">{strings.freshness.title}</span>

        <Meter reporting={reporting.length} total={primary.length} />

        <Link
          href="/sources"
          className="text-[color:var(--color-on-cloth)] underline decoration-[color:var(--color-brass)] underline-offset-2 hover:decoration-[color:var(--color-on-cloth)]"
        >
          {strings.freshness.reportingCount
            .replace('{reporting}', String(reporting.length))
            .replace('{total}', String(primary.length))}
        </Link>

        {newest ? (
          <span>
            {strings.freshness.newestDocument}{' '}
            <span className="figure text-[color:var(--color-on-cloth)]">
              {formatIstDateShort(newest, locale)}
            </span>
          </span>
        ) : null}

        {reporting.length > 0 ? (
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {reporting.slice(0, 3).map((source) => (
              <SourceMention key={source.sourceId} source={source} locale={locale} />
            ))}
          </span>
        ) : (
          <span>{strings.freshness.noneIngested}</span>
        )}

        {reporting.length > 0 && current.length < reporting.length ? (
          <span className="text-[color:var(--color-brass-soft)]">
            {strings.freshness.overdueCount.replace(
              '{count}',
              String(reporting.length - current.length),
            )}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * How much of the picture is on record, as a shape rather than a sentence.
 *
 * One cell per Tier 1 source, filled when that source has ever been fetched.
 * At a glance it answers "how complete is this?" without asking the reader to
 * divide two numbers, and it degrades honestly: an empty row is an empty row.
 */
function Meter({ reporting, total }: { reporting: number; total: number }) {
  return (
    <span
      className="flex items-center gap-[2px]"
      role="img"
      aria-label={`${reporting} of ${total}`}
    >
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={
            index < reporting
              ? 'h-3 w-[3px] bg-[color:var(--color-brass)]'
              : 'h-3 w-[3px] bg-[color:var(--color-on-cloth)] opacity-25'
          }
        />
      ))}
    </span>
  );
}

function SourceMention({ source, locale }: { source: SourceFreshness; locale: Locale }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span>{source.name}</span>
      <span className="figure text-[color:var(--color-on-cloth)]">
        {formatAge(source.hoursSinceFetch, locale)}
      </span>
    </span>
  );
}
