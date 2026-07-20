import type { Metadata } from 'next';
import { Flag } from 'lucide-react';
import {
  ANOMALY_RULES,
  type AnomalyFlag,
  type AnomalyRuleId,
  type FiscalYear,
  type MinistrySummary,
  type Severity,
} from '@nidhi/core';
import { listFlags, listMinistrySummaries, listSchemeSummaries } from '@nidhi/db';
import { FlagCard } from '@/components/flag-card';
import { FlagFilters, type FilterSpec } from '@/components/flag-filters';
import { EmptyState, PageHeader, PageShell } from '@/components/layout-primitives';
import { formatFiscalYearLong } from '@/lib/format';
import { getLocale, getStrings } from '@/lib/i18n-server';
import { resolveFy } from '@/lib/site';

/**
 * P4, the signal feed.
 *
 * Only approved signals reach this page: `listFlags` defaults to approved and
 * this page never asks for anything else, so nothing that has not cleared human
 * review is publishable here (docs/05 A3).
 *
 * Each card carries its own "what this does not establish" line, read from the
 * rule catalogue rather than passed in, which is what makes the caveat
 * structurally impossible to omit from this feed.
 */

export const revalidate = 300;

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

const RULE_IDS = Object.keys(ANOMALY_RULES) as AnomalyRuleId[];
const SEVERITIES: readonly Severity[] = ['high', 'notable', 'info'];

export async function generateMetadata(): Promise<Metadata> {
  const strings = await getStrings();
  return {
    title: strings.flags.title,
    description: strings.flags.intro,
  };
}

interface PageData {
  fy: FiscalYear;
  available: FiscalYear[];
  ministries: MinistrySummary[];
  flags: AnomalyFlag[];
}

export default async function FlagsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [params, strings, locale] = await Promise.all([searchParams, getStrings(), getLocale()]);
  const severityLabels: Record<Severity, string> = {
    high: strings.flags.severityHigh,
    notable: strings.flags.severityNotable,
    info: strings.flags.severityInfo,
  };
  const rawRule = first(params.rule);
  const ruleId = RULE_IDS.find((id) => id === rawRule);
  const rawSeverity = first(params.severity);
  const severity = SEVERITIES.find((value) => value === rawSeverity);
  const ministryId = first(params.ministry);

  let data: PageData | null = null;
  try {
    const { fy, available } = await resolveFy(first(params.fy));
    const [ministries, flags] = await Promise.all([
      listMinistrySummaries(fy, { orderBy: 'name' }),
      listFlags({
        fy,
        ...(ruleId ? { ruleId } : {}),
        ...(severity ? { severity } : {}),
        limit: 100,
      }),
    ]);

    let visible = flags;
    if (ministryId) {
      // A ministry's signals include the signals on its schemes, so the scheme
      // list for that ministry is what turns an entity filter into the filter a
      // reader actually means.
      const schemes = await listSchemeSummaries(fy, { ministryId, limit: 300 });
      const schemeIds = new Set(schemes.map((scheme) => scheme.schemeId));
      visible = flags.filter(
        (flag) =>
          (flag.entityType === 'ministry' && flag.entityId === ministryId) ||
          (flag.entityType === 'scheme' && schemeIds.has(flag.entityId)),
      );
    }

    data = { fy, available, ministries, flags: visible };
  } catch (error) {
    console.error('[flags] could not load the signal feed', error);
  }

  if (!data) {
    return (
      <PageShell>
        <PageHeader title={strings.flags.title} lede={strings.flags.intro} />
        <EmptyState
          icon={Flag}
          title={strings.flags.unavailable}
          body={strings.flags.unavailableBody}
          action={{ href: '/', label: strings.nav.overview }}
        />
      </PageShell>
    );
  }

  const filters: FilterSpec[] = [
    {
      name: 'rule',
      label: strings.flags.filterRule,
      value: ruleId ?? '',
      options: [
        { value: '', label: strings.flags.allRules },
        ...RULE_IDS.map((id) => ({ value: id, label: ANOMALY_RULES[id].label })),
      ],
    },
    {
      name: 'severity',
      label: strings.flags.filterSeverity,
      value: severity ?? '',
      options: [
        { value: '', label: strings.flags.allSeverities },
        ...SEVERITIES.map((value) => ({ value, label: severityLabels[value] })),
      ],
    },
    {
      name: 'ministry',
      label: strings.flags.filterMinistry,
      value: ministryId,
      options: [
        { value: '', label: strings.flags.allMinistries },
        ...data.ministries.map((ministry) => ({
          value: ministry.ministryId,
          label: ministry.name,
        })),
      ],
    },
    ...(data.available.length > 1
      ? [
          {
            name: 'fy',
            label: strings.common.fiscalYear,
            value: data.fy as string,
            options: data.available.map((year) => ({
              value: year as string,
              label: formatFiscalYearLong(year, locale),
            })),
          },
        ]
      : []),
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow={formatFiscalYearLong(data.fy, locale)}
        title={strings.flags.title}
        lede={strings.flags.intro}
      />

      <FlagFilters filters={filters} />

      {data.flags.length === 0 ? (
        <EmptyState
          icon={Flag}
          title={strings.flags.empty}
          body={strings.flags.emptyBody}
          action={{ href: '/flags', label: strings.filters.reset }}
        />
      ) : (
        <>
          <p className="eyebrow mb-2">
            {data.flags.length} {strings.flags.resultCount}
          </p>
          <div>
            {data.flags.map((flag) => (
              <FlagCard key={flag.flagId} flag={flag} />
            ))}
          </div>
        </>
      )}
    </PageShell>
  );
}
