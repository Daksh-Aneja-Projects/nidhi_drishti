import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Landmark, Library } from 'lucide-react';
import {
  EXTRACTION_METHOD_LABELS,
  FISCAL_STAGE_LABELS,
  LEDGER_SEPARATION_NOTICE,
  add,
  formatINRCr,
  formatPercent,
  isNotReported,
  isReported,
  percentOf,
  recentFiscalYears,
  subtract,
  type Amount,
  type MonthlySpendPoint,
  type Provenance,
  type StateEntity,
  type StateSummary,
} from '@nidhi/core';
import {
  getMonthlySpend,
  getStateAllocationHistory,
  getStateSummary,
  listStates,
} from '@nidhi/db';
import { AllocationWaterfall, type WaterfallStep } from '@/components/charts/allocation-waterfall';
import { MonthlySpendChart, type MonthlyBar } from '@/components/charts/monthly-spend-chart';
import { YoyAllocationChart, type YoyRow } from '@/components/charts/yoy-allocation-chart';
import { EmbedCode } from '@/components/embed-code';
import { FigureBlock } from '@/components/figure';
import { HeroPace } from '@/components/hero-pace';
import { Icon } from '@/components/icon';
import {
  Callout,
  Chip,
  EmptyState,
  PageShell,
  Section,
  TableScroll,
} from '@/components/layout-primitives';
import { Link } from '@/components/locale-link';
import { formatFiscalYearLong, formatIstDate, formatIstDateTime } from '@/lib/format';
import { localePath } from '@/lib/i18n';
import { getLocale, getStrings } from '@/lib/i18n-server';
import { resolveFy, siteUrl } from '@/lib/site';

/**
 * The state page (docs/12, the v2 line).
 *
 * A state budget is the same shape of data as a ministry demand, read from a
 * separate ledger, and the page says so before it says anything else: the
 * ledger separation notice sits directly under the title, ahead of every
 * figure, because a state total blends central transfers into itself and must
 * never be added to a union figure.
 *
 * Most states have nothing ingested yet. Those pages still exist, carry the
 * state's name, and say plainly what is missing and why, because an address
 * that 404s reads as an error and an empty register reads as the truth.
 */

export const revalidate = 300;

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const [{ id }, query, strings, locale] = await Promise.all([
    params,
    searchParams,
    getStrings(),
    getLocale(),
  ]);
  try {
    const { fy } = await resolveFy(query.fy);
    const [summary, entity] = await Promise.all([
      getStateSummary(fy, id),
      findState(id),
    ]);
    const name = summary?.name ?? entity?.name;
    if (!name) return { title: strings.states.notFoundTitle };
    if (!summary) return { title: `${name}, ${fy}`, description: strings.state.emptyBody };
    return {
      title: `${name}, ${fy}`,
      description: `${name}: spending authority ${formatINRCr(
        summary.currentAuthority,
      )}, expenditure reported ${formatINRCr(
        summary.expenditureToDate,
      )} for ${formatFiscalYearLong(fy, locale)}, with the source record behind every figure.`,
    };
  } catch {
    return { title: strings.states.title };
  }
}

async function findState(stateId: string): Promise<StateEntity | null> {
  const states = await listStates();
  return states.find((state) => state.stateId === stateId) ?? null;
}

export default async function StatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ id }, query, strings, locale] = await Promise.all([
    params,
    searchParams,
    getStrings(),
    getLocale(),
  ]);

  let fy = 'FY2026';
  let summary: StateSummary | null = null;
  let entity: StateEntity | null = null;
  let degraded = false;

  try {
    const context = await resolveFy(query.fy);
    fy = context.fy;
    [summary, entity] = await Promise.all([getStateSummary(fy, id), findState(id)]);
  } catch (error) {
    console.error('[state] could not load state summary', error);
    degraded = true;
  }

  if (degraded) {
    return (
      <PageShell>
        <EmptyState icon={AlertTriangle} title={strings.degraded.title} body={strings.degraded.body} />
      </PageShell>
    );
  }

  if (!summary && !entity) notFound();

  const name = summary?.name ?? entity?.name ?? id;
  const kind = summary?.kind ?? entity?.kind ?? 'state';
  const region = summary?.region ?? entity?.region ?? null;
  const kindLabel = kind === 'ut' ? strings.states.kindUt : strings.states.kindState;
  const hasLegislature = entity?.hasLegislature ?? true;

  return (
    <>
      <PageShell>
        <div className="mb-4">
          <Link
            href={`/states?fy=${fy}`}
            className="inline-flex items-center gap-1.5 text-[13px] text-[color:var(--color-ink-faint)] transition-colors hover:text-[color:var(--color-ink)]"
          >
            <Icon icon={ArrowLeft} size="xs" />
            {strings.state.backToList}
          </Link>
        </div>

        <header className="mb-6 border-b-2 border-[color:var(--color-rule-strong)] pb-5">
          <p className="eyebrow mb-1.5">
            {formatFiscalYearLong(fy, locale)}
            {region ? ` · ${region}` : ''}
          </p>
          <h1 className="font-display text-[clamp(1.6rem,3.4vw,2.4rem)] leading-[1.1]">{name}</h1>
          <p className="mt-2.5">
            <Chip tone="neutral">{kindLabel}</Chip>
          </p>
        </header>

        {/* The page's credibility armour, ahead of every figure: a state total
            and a union figure are two ledgers, never one sum (docs/12). */}
        <Callout tone="caution" title={strings.state.ledgerTitle}>
          {LEDGER_SEPARATION_NOTICE}
        </Callout>
      </PageShell>

      {summary ? (
        <StateRecord summary={summary} fy={fy} />
      ) : (
        <PageShell>
          {hasLegislature ? (
            <EmptyState
              icon={Landmark}
              title={strings.state.emptyTitle}
              body={strings.state.emptyBody}
              action={{ href: `/states?fy=${fy}`, label: strings.state.backToList }}
            />
          ) : (
            <EmptyState
              icon={Landmark}
              title={strings.state.utNoBudgetTitle}
              body={strings.state.utNoBudgetBody}
              action={{ href: '/', label: strings.nav.overview }}
            />
          )}
        </PageShell>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The record, rendered only when the year has ingested figures
 * ------------------------------------------------------------------ */

function toPlain(value: Amount): number | null {
  return isNotReported(value) ? null : value;
}

function negate(value: Amount): number | null {
  return isNotReported(value) ? null : -value;
}

function toBars(points: readonly MonthlySpendPoint[]): MonthlyBar[] {
  return points.map((point) => ({
    label: point.label,
    monthly: isNotReported(point.monthly) ? null : point.monthly,
    isProvisional: point.isProvisional,
  }));
}

async function StateRecord({ summary, fy }: { summary: StateSummary; fy: string }) {
  const [strings, locale] = await Promise.all([getStrings(), getLocale()]);

  let monthly: MonthlySpendPoint[] = [];
  let history: Awaited<ReturnType<typeof getStateAllocationHistory>> = [];
  try {
    [monthly, history] = await Promise.all([
      getMonthlySpend('state', summary.stateId, fy),
      getStateAllocationHistory(summary.stateId, recentFiscalYears(fy, 5)),
    ]);
  } catch (error) {
    console.error('[state] could not load state series', error);
  }

  const steps: WaterfallStep[] = [
    { label: FISCAL_STAGE_LABELS.BE, kind: 'total', value: toPlain(summary.be) },
    { label: FISCAL_STAGE_LABELS.RE, kind: 'delta', value: toPlain(subtract(summary.re, summary.be)) },
    { label: FISCAL_STAGE_LABELS.SUPPLEMENTARY, kind: 'delta', value: toPlain(summary.supplementary) },
    { label: strings.stage.authority, kind: 'total', value: toPlain(summary.currentAuthority) },
    { label: FISCAL_STAGE_LABELS.EXPENDITURE, kind: 'delta', value: negate(summary.expenditureToDate) },
    { label: strings.stage.balance, kind: 'total', value: toPlain(summary.balance) },
  ];

  const yoyRows: YoyRow[] = history.map((row) => ({
    fy: row.fy,
    be: toPlain(row.be),
    re: toPlain(row.re),
    expenditure: toPlain(row.expenditure),
  }));

  const splitTotal = add(summary.revenueExpenditure, summary.capitalExpenditure);
  const revenueShare = percentOf(summary.revenueExpenditure, splitTotal);
  const capitalShare = percentOf(summary.capitalExpenditure, splitTotal);

  const records = new Map<number, Provenance>();
  for (const record of [summary.provenance.authority, summary.provenance.expenditure]) {
    if (record) records.set(record.sourceRecordId, record);
  }
  for (const point of monthly) {
    if (point.provenance) records.set(point.provenance.sourceRecordId, point.provenance);
  }
  const provenanceRows = [...records.values()];

  const embedSrc = `${siteUrl}${localePath(`/embed/state/${encodeURIComponent(summary.stateId)}`, locale)}`;

  return (
    <>
      <HeroPace
        entityId={summary.stateId}
        authority={summary.currentAuthority}
        spent={summary.expenditureToDate}
        balance={summary.balance}
        burn={summary.burn}
        asOf={summary.expenditureAsOf}
        authorityProvenance={summary.provenance.authority}
        expenditureProvenance={summary.provenance.expenditure}
        unit="auto"
        label={summary.name}
      />

      <PageShell>
        <Callout tone="note">
          <p>{strings.state.coverageNote}</p>
          <p className="mt-1.5">{strings.state.annualNote}</p>
        </Callout>

        <Section title={strings.state.waterfallTitle} help={strings.state.waterfallHelp}>
          <AllocationWaterfall
            chartId="state_waterfall"
            steps={steps}
            ariaLabel={`${strings.state.waterfallTitle}, ${summary.name}, ${fy}`}
          />
        </Section>

        {/* Monthly accounts exist for the union, not for most states (docs/12
            limitation 2). The section appears only when a state actually
            publishes a monthly series, rather than as a permanent empty box
            implying a cadence states do not have. */}
        {monthly.length > 0 ? (
          <Section title={strings.state.monthlyTitle} help={strings.state.monthlyHelp}>
            <MonthlySpendChart
              chartId="state_monthly_spend"
              points={toBars(monthly)}
              ariaLabel={`${strings.state.monthlyTitle}, ${summary.name}, ${fy}`}
            />
          </Section>
        ) : null}

        <Section title={strings.state.splitTitle} help={strings.state.splitHelp}>
          {isNotReported(splitTotal) ? (
            <p className="text-[13px] text-[color:var(--color-ink-faint)]">
              {strings.state.splitEmpty}
            </p>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2">
              <FigureBlock
                label={strings.ministry.revenueLabel}
                value={summary.revenueExpenditure}
                scale="lead"
                provenance={summary.provenance.expenditure}
                metric={strings.ministry.revenueLabel}
                entityId={summary.stateId}
                stage="EXPENDITURE"
                note={formatPercent(revenueShare)}
              />
              <FigureBlock
                label={strings.ministry.capitalLabel}
                value={summary.capitalExpenditure}
                scale="lead"
                provenance={summary.provenance.expenditure}
                metric={strings.ministry.capitalLabel}
                entityId={summary.stateId}
                stage="EXPENDITURE"
                note={formatPercent(capitalShare)}
              />
              <div
                className="flex h-4 w-full overflow-hidden sm:col-span-2"
                role="img"
                aria-label={`${strings.ministry.revenueLabel} ${formatPercent(
                  revenueShare,
                )}, ${strings.ministry.capitalLabel} ${formatPercent(capitalShare)}`}
                style={{ backgroundColor: 'var(--color-paper-sunk)' }}
              >
                <span
                  style={{
                    width: isReported(revenueShare) ? `${revenueShare}%` : '0%',
                    backgroundColor: 'var(--color-behind)',
                  }}
                />
                <span
                  style={{
                    width: isReported(capitalShare) ? `${capitalShare}%` : '0%',
                    backgroundColor: 'var(--color-ahead)',
                  }}
                />
              </div>
            </div>
          )}
        </Section>

        <Section title={strings.state.yoyTitle} help={strings.state.yoyHelp}>
          {yoyRows.length > 1 ? (
            <YoyAllocationChart
              chartId="state_yoy_allocation"
              rows={yoyRows}
              ariaLabel={`${strings.state.yoyTitle}, ${summary.name}`}
            />
          ) : (
            <p className="text-[13px] text-[color:var(--color-ink-faint)]">
              {strings.state.yoyEmpty}
            </p>
          )}
        </Section>

        <Section title={strings.state.sourcesTitle} help={strings.state.sourcesHelp}>
          {provenanceRows.length === 0 ? (
            <EmptyState
              icon={Library}
              title={strings.state.sourcesTitle}
              body={strings.state.sourcesEmpty}
            />
          ) : (
            <TableScroll>
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">{strings.provenance.source}</th>
                    <th scope="col">{strings.provenance.documentDate}</th>
                    <th scope="col">{strings.provenance.fetched}</th>
                    <th scope="col">{strings.provenance.method}</th>
                    <th scope="col">{strings.provenance.document}</th>
                  </tr>
                </thead>
                <tbody>
                  {provenanceRows.map((record) => (
                    <tr key={record.sourceRecordId}>
                      <td>
                        {record.sourceName}
                        {record.isProvisional ? (
                          <span className="ml-2">
                            <Chip tone="muted">{strings.common.provisional}</Chip>
                          </span>
                        ) : null}
                      </td>
                      <td className="text-[13px]">
                        {record.documentDate
                          ? formatIstDate(record.documentDate, locale)
                          : strings.common.notStated}
                      </td>
                      <td className="text-[13px]">{formatIstDateTime(record.fetchedAt, locale)}</td>
                      <td className="text-[13px]">
                        {EXTRACTION_METHOD_LABELS[record.extractionMethod]}
                      </td>
                      <td className="text-[13px]">
                        {record.url ? (
                          <a
                            href={record.url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="underline decoration-[color:var(--color-rule-strong)] underline-offset-2"
                          >
                            {strings.provenance.openSource}
                          </a>
                        ) : (
                          strings.common.notStated
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Section>

        <Section title={strings.state.embedTitle} help={strings.state.embedHelp}>
          <EmbedCode src={embedSrc} title={summary.name} entityId={summary.stateId} />
        </Section>
      </PageShell>
    </>
  );
}
