import type { Metadata } from 'next';
import {
  burnColor,
  computeVariances,
  fiscalYearRange,
  formatINRCr,
  formatINRLakhCr,
  formatPercent,
  isNotReported,
  parFractionAt,
  summariseVariances,
  VARIANCE_POSITION_LABELS,
  type Variance,
  type VarianceInput,
} from '@nidhi/core';
import { listMinistrySummaries } from '@nidhi/db';
import { PaceDistribution } from '@/components/charts/pace-distribution';
import { VarianceBars } from '@/components/charts/variance-bars';
import { PaceLegend } from '@/components/pace-track';
import { PageHeader, PageShell, Section } from '@/components/layout-primitives';
import { formatFiscalYearLong } from '@/lib/format';
import { getLocale, getStrings } from '@/lib/i18n-server';
import { resolveFy } from '@/lib/site';

/**
 * Variance analysis across every ministry that reports both halves.
 *
 * This is the page that answers the question the rest of the site only lets you
 * ask one ministry at a time: across the whole government, where is the money
 * not moving, and how much of it is there?
 *
 * The discipline that makes it publishable rather than accusatory is the same
 * discipline as everywhere else in the product. The comparison is stated as a
 * distance from a straight line, the straight line is named as an assumption
 * rather than a rule, the limits are on the page rather than in a footnote, and
 * ministries that do not report are left out rather than ranked at the bottom.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const strings = await getStrings();
  return { title: strings.analysis.title, description: strings.analysis.lede };
}

export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [strings, locale, params] = await Promise.all([
    getStrings(),
    getLocale(),
    searchParams,
  ]);

  let fy = 'FY2026';
  let ministries: Awaited<ReturnType<typeof listMinistrySummaries>> = [];
  let degraded = false;
  try {
    const context = await resolveFy(params.fy as string | string[] | undefined);
    fy = context.fy;
    ministries = await listMinistrySummaries(fy, { limit: 500 });
  } catch (error) {
    console.error('[analysis] could not load ministry summaries', error);
    degraded = true;
  }

  const { startDate, endDate } = fiscalYearRange(fy);

  // Par comes from the date the expenditure figure actually covers, per
  // ministry. Assuming today would compare a December figure against a year
  // that is nearly over and silently overstate every shortfall.
  const inputs: VarianceInput[] = ministries.map((ministry) => {
    const par = parFractionAt(startDate, endDate, ministry.expenditureAsOf);
    return {
      entityId: ministry.ministryId,
      name: ministry.name,
      sector: ministry.sector,
      authority: ministry.currentAuthority,
      spent: ministry.expenditureToDate,
      parFraction: isNotReported(par) ? 0 : par,
    };
  });

  const { variances, skipped } = computeVariances(inputs);
  const totals = summariseVariances(variances);

  // Every ministry compared here shares one expenditure date in practice,
  // because they come from one statement. Read it back rather than assuming.
  const parFraction = variances[0]?.parFraction ?? 0;
  const parLabel = `${strings.analysis.parLabel} ${formatPercent(parFraction * 100, { decimals: 0 })}`;

  const decorated = variances.map((item) => ({
    ...item,
    color: burnColor(item.paceRatio),
    authorityText: formatINRCr(item.authority),
    spentText: formatINRCr(item.spent),
    varianceText: formatINRCr(item.varianceCr, { signed: true }),
    paceText: `${formatPercent(item.absorption * 100, { decimals: 1 })} ${strings.pace.spendMarker.toLowerCase()}`,
  }));

  return (
    <PageShell>
      <PageHeader
        eyebrow={`${strings.analysis.eyebrow} · ${formatFiscalYearLong(fy, locale)}`}
        title={strings.analysis.title}
        lede={strings.analysis.lede}
      />

      {degraded || variances.length === 0 ? (
        <p className="max-w-[60ch] py-8 text-[color:var(--color-ink-soft)]">
          {degraded ? strings.degraded.body : strings.pace.unavailable}
        </p>
      ) : (
        <>
          <Headline
            behindCr={totals.behindCr}
            aheadCr={totals.aheadCr}
            behindCount={totals.behindCount}
            aheadCount={totals.aheadCount}
            strings={strings}
          />

          <Section title={strings.analysis.distributionTitle} help={strings.analysis.distributionLede}>
            <PaceDistribution
              points={decorated.map((item) => ({
                id: item.entityId,
                name: item.name,
                paceRatio: item.paceRatio,
                authority: item.authority,
                color: item.color,
                authorityText: item.authorityText,
                spentText: item.spentText,
                paceText: item.paceText,
              }))}
              parLabel={parLabel}
            />
            {/* Colour carries the pace on both charts below, so the scale it
                encodes has to be stated once, near the first chart that uses
                it. A chart whose colour means something without a legend is a
                chart the reader has to guess at. */}
            <PaceLegend className="mt-4" />
          </Section>

          <Section title={strings.analysis.title}>
            <VarianceBars
              rows={decorated.map((item) => ({
                id: item.entityId,
                name: item.name,
                varianceCr: item.varianceCr,
                color: item.color,
                authorityText: item.authorityText,
                spentText: item.spentText,
                varianceText: item.varianceText,
                paceText: item.paceText,
              }))}
            />
          </Section>

          <Section title={strings.analysis.concentrationTitle}>
            <p className="prose-civic">
              {strings.analysis.concentrationBody
                .replace('{n}', '5')
                .replace('{share}', formatPercent(totals.concentrationTopN(5) * 100, { decimals: 0 }))}
            </p>
            <ScorecardTable rows={decorated} strings={strings} locale={locale} />
          </Section>
        </>
      )}

      <Section title={strings.analysis.methodTitle}>
        <p className="prose-civic">{strings.analysis.methodBody}</p>
        {skipped > 0 ? (
          <p className="prose-civic mt-3 text-[color:var(--color-ink-faint)]">
            {strings.analysis.skippedNote
              .replace('{count}', String(skipped))
              .replace('{total}', String(ministries.length))}
          </p>
        ) : null}
      </Section>

      <Section title={strings.analysis.limitsTitle}>
        <ul className="prose-civic space-y-2">
          {strings.analysis.limits.map((limit) => (
            <li key={limit} className="flex gap-3">
              <span
                aria-hidden="true"
                className="mt-[0.6em] h-px w-4 shrink-0 bg-[color:var(--color-rule-strong)]"
              />
              <span>{limit}</span>
            </li>
          ))}
        </ul>
      </Section>
    </PageShell>
  );
}

/**
 * The two quantities worth stating before any chart.
 *
 * Behind and ahead are given separately and never netted: a government half far
 * behind and half far ahead nets to nothing, and reporting that zero would
 * describe neither half.
 */
function Headline({
  behindCr,
  aheadCr,
  behindCount,
  aheadCount,
  strings,
}: {
  behindCr: number;
  aheadCr: number;
  behindCount: number;
  aheadCount: number;
  strings: Awaited<ReturnType<typeof getStrings>>;
}) {
  return (
    <section className="leaf relative my-6 overflow-hidden">
      <div className="grid gap-x-10 gap-y-6 px-5 py-7 sm:px-8 md:grid-cols-2">
        <div>
          <p className="eyebrow mb-1.5">
            {behindCount} {strings.common.ministry.toLowerCase()}
          </p>
          <p className="figure text-[clamp(2rem,5vw,3.25rem)] font-medium leading-none tracking-[-0.03em] text-[color:var(--color-behind)]">
            {formatINRLakhCr(Math.abs(behindCr))}
          </p>
          <p className="mt-1.5 text-sm text-[color:var(--color-ink-soft)]">
            {strings.analysis.behindHeadline}
          </p>
        </div>
        <div>
          <p className="eyebrow mb-1.5">
            {aheadCount} {strings.common.ministry.toLowerCase()}
          </p>
          <p className="figure text-[clamp(2rem,5vw,3.25rem)] font-medium leading-none tracking-[-0.03em] text-[color:var(--color-ahead)]">
            {formatINRLakhCr(aheadCr)}
          </p>
          <p className="mt-1.5 text-sm text-[color:var(--color-ink-soft)]">
            {strings.analysis.aheadHeadline}
          </p>
        </div>
      </div>
      <p className="border-t border-[color:var(--color-rule)] px-5 py-3 text-[12px] leading-snug text-[color:var(--color-ink-faint)] sm:px-8">
        {strings.analysis.behindHelp}
      </p>
    </section>
  );
}

function ScorecardTable({
  rows,
  strings,
}: {
  rows: Array<Variance & { color: string; authorityText: string; spentText: string; varianceText: string }>;
  strings: Awaited<ReturnType<typeof getStrings>>;
  locale: string;
}) {
  const ordered = [...rows].sort((a, b) => a.varianceCr - b.varianceCr);
  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-[color:var(--color-rule-strong)] text-left">
            <th scope="col" className="eyebrow py-2 pr-4">
              {strings.analysis.colMinistry}
            </th>
            <th scope="col" className="eyebrow py-2 pr-4 text-right">
              {strings.analysis.colAuthority}
            </th>
            <th scope="col" className="eyebrow py-2 pr-4 text-right">
              {strings.analysis.colSpent}
            </th>
            <th scope="col" className="eyebrow py-2 pr-4 text-right">
              {strings.analysis.colAbsorption}
            </th>
            <th scope="col" className="eyebrow py-2 pr-4 text-right">
              {strings.analysis.colVariance}
            </th>
            <th scope="col" className="eyebrow py-2">
              {strings.analysis.colPosition}
            </th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((row) => (
            <tr key={row.entityId} className="border-b border-[color:var(--color-rule)]">
              <th scope="row" className="py-2 pr-4 text-left font-normal">
                {row.name}
              </th>
              <td className="figure py-2 pr-4 text-right">{row.authorityText}</td>
              <td className="figure py-2 pr-4 text-right">{row.spentText}</td>
              <td className="figure py-2 pr-4 text-right">
                {formatPercent(row.absorption * 100, { decimals: 1 })}
              </td>
              <td
                className="figure py-2 pr-4 text-right"
                style={{ color: row.varianceCr < 0 ? 'var(--color-behind)' : 'var(--color-ahead)' }}
              >
                {row.varianceText}
              </td>
              <td className="py-2">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 shrink-0"
                    style={{ backgroundColor: row.color }}
                  />
                  <span className="text-[13px] text-[color:var(--color-ink-soft)]">
                    {VARIANCE_POSITION_LABELS[row.position]}
                  </span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
