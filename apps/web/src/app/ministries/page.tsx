import type { Metadata } from 'next';
import { AlertTriangle, Download, Landmark } from 'lucide-react';
import { formatFiscalYearLong, type MinistrySummary } from '@nidhi/core';
import { listMinistrySummaries } from '@nidhi/db';
import { Icon } from '@/components/icon';
import { EmptyState, PageHeader, PageShell } from '@/components/layout-primitives';
import { MinistryTable, resolveMinistrySort } from '@/components/ministry-table';
import { PaceLegend } from '@/components/pace-track';
import { resolveFy } from '@/lib/site';
import { strings } from '@/lib/strings';

/**
 * The ministry index.
 *
 * One row per demand, sorted from the query string so the view is a link. The
 * whole table is a server render: the figures keep their provenance triggers
 * without shipping the dataset to the browser.
 */

export const revalidate = 300;

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const params = await searchParams;
  const requested = Array.isArray(params.fy) ? params.fy[0] : params.fy;
  const suffix = requested ? ` ${requested}` : '';
  return {
    title: `${strings.ministries.title}${suffix}`,
    description: strings.ministries.lede,
  };
}

export default async function MinistriesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { sort, dir } = resolveMinistrySort(params.sort, params.dir);

  let fy: string;
  let rows: MinistrySummary[] = [];
  let degraded = false;

  try {
    const context = await resolveFy(params.fy);
    fy = context.fy;
    rows = await listMinistrySummaries(fy, { orderBy: 'allocation', limit: 500 });
  } catch (error) {
    console.error('[ministries] could not load ministry summaries', error);
    fy = 'FY2026';
    degraded = true;
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow={formatFiscalYearLong(fy)}
        title={strings.ministries.title}
        lede={strings.ministries.lede}
        actions={
          rows.length > 0 ? (
            <a
              href={`/api/v1/export/ministries?fy=${fy}`}
              className="inline-flex items-center gap-1.5 border border-[color:var(--color-rule-strong)] px-3 py-1.5 text-[13px] text-[color:var(--color-ink-soft)] transition-colors hover:text-[color:var(--color-ink)]"
            >
              <Icon icon={Download} size="sm" />
              {strings.common.export}
            </a>
          ) : null
        }
      />

      {degraded ? (
        <EmptyState icon={AlertTriangle} title={strings.degraded.title} body={strings.degraded.body} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title={strings.ministries.emptyTitle}
          body={strings.ministries.emptyBody}
          action={{ href: '/', label: strings.nav.overview }}
        />
      ) : (
        <>
          <p className="mb-3 text-[13px] text-[color:var(--color-ink-faint)]">
            {rows.length} {strings.ministries.counted}
          </p>
          <MinistryTable rows={rows} fy={fy} sort={sort} dir={dir} />
          <PaceLegend className="mt-5" />
        </>
      )}
    </PageShell>
  );
}
