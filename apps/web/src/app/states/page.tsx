import type { Metadata } from 'next';
import { AlertTriangle, Map as MapIcon } from 'lucide-react';
import { LEDGER_SEPARATION_NOTICE, type StateEntity, type StateSummary } from '@nidhi/core';
import { listStates, listStateSummaries } from '@nidhi/db';
import { Callout, EmptyState, PageHeader, PageShell } from '@/components/layout-primitives';
import { PaceLegend } from '@/components/pace-track';
import { StateTable, resolveStateSort, type StateRowData } from '@/components/state-table';
import { formatFiscalYearLong } from '@/lib/format';
import { getLocale, getStrings } from '@/lib/i18n-server';
import { resolveFy } from '@/lib/site';

/**
 * The state index (docs/12, the v2 line).
 *
 * The reference list of all 28 states and 8 union territories is the spine of
 * the page, joined to the year's summaries where ingestion has produced one.
 * Ingestion begins with two states, so most rows read "Not reported", and the
 * page says so plainly instead of hiding the thin coverage.
 *
 * The ledger separation notice sits above the table, not in a footnote: this is
 * the first screen where state figures appear near union ones in the same
 * product, and the rule that they are never added together arrives before any
 * figure does.
 */

export const revalidate = 300;

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const [params, strings] = await Promise.all([searchParams, getStrings()]);
  const requested = Array.isArray(params.fy) ? params.fy[0] : params.fy;
  const suffix = requested ? ` ${requested}` : '';
  return {
    title: `${strings.states.title}${suffix}`,
    description: strings.states.lede,
  };
}

export default async function StatesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [params, strings, locale] = await Promise.all([searchParams, getStrings(), getLocale()]);
  const { sort, dir } = resolveStateSort(params.sort, params.dir);

  let fy = 'FY2026';
  let entities: StateEntity[] = [];
  let summaries: StateSummary[] = [];
  let degraded = false;

  try {
    const context = await resolveFy(params.fy);
    fy = context.fy;
    [entities, summaries] = await Promise.all([
      listStates(),
      listStateSummaries(fy, { limit: 50 }),
    ]);
  } catch (error) {
    console.error('[states] could not load the state register', error);
    degraded = true;
  }

  const summaryByState = new Map(summaries.map((summary) => [summary.stateId, summary]));
  const rows: StateRowData[] = entities.map((entity) => ({
    entity,
    summary: summaryByState.get(entity.stateId) ?? null,
  }));

  return (
    <PageShell>
      <PageHeader
        eyebrow={formatFiscalYearLong(fy, locale)}
        title={strings.states.title}
        lede={strings.states.lede}
      />

      {degraded ? (
        <EmptyState icon={AlertTriangle} title={strings.degraded.title} body={strings.degraded.body} />
      ) : rows.length === 0 ? (
        <EmptyState icon={MapIcon} title={strings.states.emptyTitle} body={strings.states.emptyBody} />
      ) : (
        <>
          <div className="mb-5 space-y-3">
            <Callout tone="caution" title={strings.state.ledgerTitle}>
              {LEDGER_SEPARATION_NOTICE}
            </Callout>
            <Callout tone="note">{strings.states.coverage}</Callout>
          </div>

          <p className="mb-3 text-[13px] text-[color:var(--color-ink-faint)]">
            {rows.length} {strings.states.counted}
          </p>
          <StateTable rows={rows} fy={fy} sort={sort} dir={dir} />
          <PaceLegend className="mt-5" />
        </>
      )}
    </PageShell>
  );
}
