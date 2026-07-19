import type { Metadata } from 'next';
import Link from 'next/link';
import { Layers } from 'lucide-react';
import {
  formatFiscalYearLong,
  formatPercent,
  isNotReported,
  type FiscalYear,
  type MinistrySummary,
  type SchemeSummary,
  type SchemeType,
} from '@nidhi/core';
import { listMinistrySummaries, listSchemeSummaries } from '@nidhi/db';
import { Figure } from '@/components/figure';
import { FilterBar, type FilterSpec } from '@/components/flag-filters';
import { EmptyState, PageHeader, PageShell, Section, TableScroll } from '@/components/layout-primitives';
import { resolveFy } from '@/lib/site';
import { strings } from '@/lib/strings';

/**
 * The scheme index.
 *
 * Filtering and sorting happen in the query string and are resolved on the
 * server, so every view of this table is a link that opens the same way for the
 * next person. Utilisation is shown as a share, and where no utilisation has
 * been reported the cell says so rather than showing a zero.
 */

export const revalidate = 300;

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

const SCHEME_TYPES: readonly SchemeType[] = ['CSS', 'CS', 'other'];

const SCHEME_TYPE_LABELS: Record<SchemeType, string> = {
  CSS: strings.schemes.typeCss,
  CS: strings.schemes.typeCs,
  other: strings.schemes.typeOther,
};

const SORTS = ['allocation', 'utilization_asc', 'name'] as const;
type SchemeSort = (typeof SORTS)[number];

const SORT_LABELS: Record<SchemeSort, string> = {
  allocation: strings.schemes.sortAllocation,
  utilization_asc: strings.schemes.sortUtilisation,
  name: strings.schemes.sortName,
};

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const params = await searchParams;
  let fyLabel = '';
  try {
    const { fy } = await resolveFy(first(params.fy));
    fyLabel = ` ${formatFiscalYearLong(fy)}`;
  } catch {
    fyLabel = '';
  }
  return {
    title: strings.schemes.title,
    description: `${strings.schemes.intro}${fyLabel}`,
  };
}

interface PageData {
  fy: FiscalYear;
  ministries: MinistrySummary[];
  schemes: SchemeSummary[];
}

export default async function SchemesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const ministryId = first(params.ministry);
  const rawType = first(params.type);
  const schemeType = SCHEME_TYPES.find((type) => type === rawType);
  const rawSort = first(params.sort);
  const sort: SchemeSort = SORTS.find((value) => value === rawSort) ?? 'allocation';

  let data: PageData | null = null;
  try {
    const { fy } = await resolveFy(first(params.fy));
    const [ministries, schemes] = await Promise.all([
      listMinistrySummaries(fy, { orderBy: 'name' }),
      listSchemeSummaries(fy, {
        ...(ministryId ? { ministryId } : {}),
        ...(schemeType ? { schemeType } : {}),
        orderBy: sort,
        limit: 300,
      }),
    ]);
    data = { fy, ministries, schemes };
  } catch (error) {
    console.error('[schemes] could not load scheme index', error);
  }

  if (!data) {
    return (
      <PageShell>
        <PageHeader title={strings.schemes.title} lede={strings.schemes.intro} />
        <EmptyState
          icon={Layers}
          title={strings.schemes.unavailable}
          body={strings.schemes.unavailableBody}
          action={{ href: '/', label: strings.nav.overview }}
        />
      </PageShell>
    );
  }

  const filters: FilterSpec[] = [
    {
      name: 'ministry',
      label: strings.schemes.filterMinistry,
      value: ministryId,
      options: [
        { value: '', label: strings.schemes.allMinistries },
        ...data.ministries.map((ministry) => ({
          value: ministry.ministryId,
          label: ministry.name,
        })),
      ],
    },
    {
      name: 'type',
      label: strings.schemes.filterType,
      value: schemeType ?? '',
      options: [
        { value: '', label: strings.schemes.allTypes },
        ...SCHEME_TYPES.map((type) => ({ value: type, label: SCHEME_TYPE_LABELS[type] })),
      ],
    },
    {
      name: 'sort',
      label: strings.schemes.sort,
      value: sort,
      options: SORTS.map((value) => ({ value, label: SORT_LABELS[value] })),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow={formatFiscalYearLong(data.fy)}
        title={strings.schemes.title}
        lede={strings.schemes.intro}
      />

      <FilterBar filters={filters} />

      {data.schemes.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={strings.schemes.empty}
          body={strings.schemes.emptyBody}
          action={{ href: '/schemes', label: strings.filters.reset }}
        />
      ) : (
        <Section title={`${data.schemes.length} ${strings.schemes.resultCount}`}>
          <TableScroll>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{strings.schemes.columnScheme}</th>
                  <th scope="col">{strings.schemes.columnMinistry}</th>
                  <th scope="col">{strings.schemes.columnType}</th>
                  <th scope="col" className="num">
                    {strings.schemes.columnAllocation}
                  </th>
                  <th scope="col" className="num">
                    {strings.schemes.columnReleased}
                  </th>
                  <th scope="col" className="num">
                    {strings.schemes.columnUtilisation}
                  </th>
                  <th scope="col" className="num">
                    {strings.schemes.columnTenders}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.schemes.map((scheme) => (
                  <tr key={scheme.schemeId}>
                    <td className="min-w-[16rem] max-w-[28rem]">
                      <Link
                        href={`/scheme/${scheme.schemeId}`}
                        className="underline decoration-[color:var(--color-rule-strong)] underline-offset-2 hover:decoration-[color:var(--color-ink)]"
                      >
                        {scheme.name}
                      </Link>
                    </td>
                    <td className="text-[13px] text-[color:var(--color-ink-soft)]">
                      {scheme.ministryId && scheme.ministryName ? (
                        <Link
                          href={`/ministry/${scheme.ministryId}`}
                          className="underline decoration-[color:var(--color-rule)] underline-offset-2 hover:decoration-[color:var(--color-ink)]"
                        >
                          {scheme.ministryName}
                        </Link>
                      ) : (
                        strings.common.notStated
                      )}
                    </td>
                    <td className="text-[13px] text-[color:var(--color-ink-soft)]">
                      {scheme.schemeType
                        ? SCHEME_TYPE_LABELS[scheme.schemeType]
                        : strings.common.notStated}
                    </td>
                    <td className="num">
                      <Figure
                        value={scheme.allocation}
                        scale="dense"
                        stage="BE"
                        metric="scheme_allocation"
                        entityId={scheme.schemeId}
                        provenance={scheme.provenance.allocation}
                      />
                    </td>
                    <td className="num">
                      <Figure
                        value={scheme.released}
                        scale="dense"
                        stage="RELEASE"
                        metric="scheme_released"
                        entityId={scheme.schemeId}
                        provenance={scheme.provenance.released}
                      />
                    </td>
                    <td className="num">
                      {isNotReported(scheme.utilizationPct) ? (
                        <span
                          className="figure text-[13px]"
                          style={{ color: 'var(--color-unreported)' }}
                          title={strings.common.notReportedHelp}
                        >
                          {strings.common.notReported}
                        </span>
                      ) : (
                        <span className="figure text-[13px]">
                          {formatPercent(scheme.utilizationPct, { decimals: 1 })}
                        </span>
                      )}
                    </td>
                    <td className="num text-[13px]">{scheme.tenderCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Section>
      )}
    </PageShell>
  );
}
