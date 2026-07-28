import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  FileSearch,
  Layers,
  Library,
} from 'lucide-react';
import {
  AI_NARRATIVE_NOTICE,
  ANOMALY_RULES,
  EXTRACTION_METHOD_LABELS,
  FISCAL_STAGE_LABELS,
  add,
  formatINRCr,
  formatPercent,
  isNotReported,
  isReported,
  percentOf,
  previousFiscalYear,
  recentFiscalYears,
  subtract,
  type AnomalyFlag,
  type MinistrySummary,
  type MonthlySpendPoint,
  type Provenance,
  type SchemeSummary,
  type SourceRegistryEntry,
  type VerificationReport,
} from '@nidhi/core';
import {
  getLatestVerificationReport,
  getMinistryAllocationHistory,
  getMinistrySummary,
  getMonthlySpend,
  listFlags,
  listSchemeSummaries,
  listSourceRegistry,
} from '@nidhi/db';
import { AllocationWaterfall, type WaterfallStep } from '@/components/charts/allocation-waterfall';
import { MonthlySpendChart, type MonthlyBar } from '@/components/charts/monthly-spend-chart';
import { YoyAllocationChart, type YoyRow } from '@/components/charts/yoy-allocation-chart';
import { Figure, FigureBlock } from '@/components/figure';
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
import { getLocale, getStrings } from '@/lib/i18n-server';
import { resolveFy } from '@/lib/site';

/**
 * P2, the ministry page.
 *
 * The tab lives in the query string rather than in client state, so a link to
 * the verification narrative or to the source records is a link a journalist
 * can send. Each tab is a separate server render and only loads what it shows.
 */

export const revalidate = 300;

const TABS = ['overview', 'schemes', 'verification', 'flags', 'sources'] as const;
type Tab = (typeof TABS)[number];

type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function resolveTab(raw: string | string[] | undefined): Tab {
  const candidate = firstParam(raw);
  return (TABS as readonly string[]).includes(candidate ?? '') ? (candidate as Tab) : 'overview';
}

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
    const ministry = await getMinistrySummary(fy, id);
    if (!ministry) return { title: strings.ministry.notFoundTitle };
    return {
      title: `${ministry.name}, ${fy}`,
      description: `${ministry.name}: spending authority ${formatINRCr(
        ministry.currentAuthority,
      )}, expenditure accounted to date ${formatINRCr(
        ministry.expenditureToDate,
      )} for ${formatFiscalYearLong(fy, locale)}, with the source record behind every figure.`,
    };
  } catch {
    return { title: strings.common.ministry };
  }
}

export default async function MinistryPage({
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
  const tab = resolveTab(query.tab);
  const tabLabels: Record<Tab, string> = {
    overview: strings.ministry.tabs.overview,
    schemes: strings.ministry.tabs.schemes,
    verification: strings.ministry.tabs.verification,
    flags: strings.ministry.tabs.flags,
    sources: strings.ministry.tabs.sources,
  };

  let fy = 'FY2026';
  let ministry: MinistrySummary | null = null;
  let degraded = false;

  try {
    const context = await resolveFy(query.fy);
    fy = context.fy;
    ministry = await getMinistrySummary(fy, id);
  } catch (error) {
    console.error('[ministry] could not load ministry summary', error);
    degraded = true;
  }

  if (degraded) {
    return (
      <PageShell>
        <EmptyState icon={AlertTriangle} title={strings.degraded.title} body={strings.degraded.body} />
      </PageShell>
    );
  }

  if (!ministry) notFound();

  const tabHref = (next: Tab) =>
    `/ministry/${encodeURIComponent(id)}?fy=${fy}${next === 'overview' ? '' : `&tab=${next}`}`;

  return (
    <>
      <PageShell>
        <div className="mb-4">
          <Link
            href={`/ministries?fy=${fy}`}
            className="inline-flex items-center gap-1.5 text-[13px] text-[color:var(--color-ink-faint)] transition-colors hover:text-[color:var(--color-ink)]"
          >
            <Icon icon={ArrowLeft} size="xs" />
            {strings.ministry.backToList}
          </Link>
        </div>

        <header className="mb-6 border-b-2 border-[color:var(--color-rule-strong)] pb-5">
          <p className="eyebrow mb-1.5">
            {formatFiscalYearLong(fy, locale)}
            {ministry.sector ? ` · ${ministry.sector}` : ''}
          </p>
          <h1 className="font-display text-[clamp(1.6rem,3.4vw,2.4rem)] leading-[1.1]">
            {ministry.name}
          </h1>
          {ministry.openFlagCount > 0 ? (
            <p className="mt-2.5">
              <Link href={tabHref('flags')}>
                <Chip tone="seal">
                  {ministry.openFlagCount} {strings.ministry.openSignals.toLowerCase()}
                </Chip>
              </Link>
            </p>
          ) : null}
        </header>

        <nav aria-label={strings.common.ministry} className="mb-1">
          <ul className="flex flex-wrap gap-x-1 gap-y-1 border-b border-[color:var(--color-rule-strong)]">
            {TABS.map((item) => {
              const active = item === tab;
              return (
                <li key={item}>
                  <Link
                    href={tabHref(item)}
                    aria-current={active ? 'page' : undefined}
                    className={`inline-block border-b-2 px-3 py-2 text-[13px] transition-colors ${
                      active
                        ? 'border-[color:var(--color-seal)] font-medium text-[color:var(--color-ink)]'
                        : 'border-transparent text-[color:var(--color-ink-faint)] hover:text-[color:var(--color-ink)]'
                    }`}
                  >
                    {tabLabels[item]}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </PageShell>

      {tab === 'overview' ? <OverviewTab ministry={ministry} fy={fy} /> : null}
      {tab === 'schemes' ? <SchemesTab ministryId={id} fy={fy} /> : null}
      {tab === 'verification' ? <VerificationTab ministryId={id} fy={fy} /> : null}
      {tab === 'flags' ? <FlagsTab ministryId={id} fy={fy} /> : null}
      {tab === 'sources' ? <SourcesTab ministry={ministry} fy={fy} /> : null}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Overview
 * ------------------------------------------------------------------ */

function toBars(points: readonly MonthlySpendPoint[]): MonthlyBar[] {
  return points.map((point) => ({
    label: point.label,
    monthly: isNotReported(point.monthly) ? null : point.monthly,
    isProvisional: point.isProvisional,
  }));
}

async function OverviewTab({ ministry, fy }: { ministry: MinistrySummary; fy: string }) {
  const strings = await getStrings();
  const priorFy = previousFiscalYear(fy);

  let monthly: MonthlySpendPoint[] = [];
  let priorMonthly: MonthlySpendPoint[] = [];
  let history: Awaited<ReturnType<typeof getMinistryAllocationHistory>> = [];

  try {
    [monthly, priorMonthly, history] = await Promise.all([
      getMonthlySpend('ministry', ministry.ministryId, fy),
      getMonthlySpend('ministry', ministry.ministryId, priorFy),
      getMinistryAllocationHistory(ministry.ministryId, recentFiscalYears(fy, 5)),
    ]);
  } catch (error) {
    console.error('[ministry] could not load overview series', error);
  }

  const bars = toBars(monthly);
  // At least one month whose own spend could actually be recovered from the
  // cumulative series. See the monthly section below.
  const hasMonthlyValues = bars.some((bar) => bar.monthly !== null);
  const priorByIndex = new Map(
    priorMonthly.map((point) => [
      point.fiscalMonthIndex,
      isNotReported(point.monthly) ? null : point.monthly,
    ]),
  );
  const priorBars = monthly.map((point) => ({
    label: point.label,
    monthly: priorByIndex.get(point.fiscalMonthIndex) ?? null,
  }));

  // The revision is a delta from the budget estimate, but only where the budget
  // estimate is on record. Where a source publishes the revised estimate alone,
  // subtracting an unreported figure from it renders "Revised estimate: Not
  // reported" beside a spending authority derived from that very number, which
  // reads as a contradiction. In that case the revised estimate is the opening
  // total, which is what it actually is here.
  const beIsReported = !isNotReported(ministry.be);
  const openingSteps: WaterfallStep[] = beIsReported
    ? [
        { label: FISCAL_STAGE_LABELS.BE, kind: 'total', value: toPlain(ministry.be) },
        {
          label: FISCAL_STAGE_LABELS.RE,
          kind: 'delta',
          value: toPlain(subtract(ministry.re, ministry.be)),
        },
      ]
    : [{ label: FISCAL_STAGE_LABELS.RE, kind: 'total', value: toPlain(ministry.re) }];

  // A revision that was never presented and a supplementary grant that was
  // never voted are not zero-height bars: they are steps that did not happen.
  // Drawing them anyway spends a fifth of the chart on an empty slot and
  // invites the reader to see a missing quantity where there is simply no
  // event, so a step the source does not report is dropped.
  const hasSupplementary = !isNotReported(ministry.supplementary);

  // With no budget estimate and no supplementary, the opening total and the
  // spending authority are the same number, and the chart would draw it twice
  // as two identical full-height bars. One opening step, correctly labelled, is
  // the whole truth in that case.
  const authorityIsOpening = !beIsReported && !hasSupplementary;

  const steps: WaterfallStep[] = [
    ...(authorityIsOpening
      ? [
          {
            label: strings.stage.authority,
            kind: 'total' as const,
            value: toPlain(ministry.currentAuthority),
          },
        ]
      : [
          ...openingSteps,
          ...(hasSupplementary
            ? [
                {
                  label: FISCAL_STAGE_LABELS.SUPPLEMENTARY,
                  kind: 'delta' as const,
                  value: toPlain(ministry.supplementary),
                },
              ]
            : []),
          {
            label: strings.stage.authority,
            kind: 'total' as const,
            value: toPlain(ministry.currentAuthority),
          },
        ]),
    {
      label: FISCAL_STAGE_LABELS.EXPENDITURE,
      kind: 'delta',
      value: negate(ministry.expenditureToDate),
    },
    { label: strings.stage.balance, kind: 'total', value: toPlain(ministry.balance) },
  ];

  const yoyRows: YoyRow[] = history.map((row) => ({
    fy: row.fy,
    be: toPlain(row.be),
    re: toPlain(row.re),
    expenditure: toPlain(row.expenditure),
  }));

  const splitTotal = add(ministry.revenueExpenditure, ministry.capitalExpenditure);
  const revenueShare = percentOf(ministry.revenueExpenditure, splitTotal);
  const capitalShare = percentOf(ministry.capitalExpenditure, splitTotal);

  return (
    <>
      <HeroPace
        entityId={ministry.ministryId}
        authority={ministry.currentAuthority}
        spent={ministry.expenditureToDate}
        balance={ministry.balance}
        burn={ministry.burn}
        asOf={ministry.expenditureAsOf}
        authorityProvenance={ministry.provenance.authority}
        expenditureProvenance={ministry.provenance.expenditure}
        unit="crore"
        label={ministry.name}
      />

      <PageShell>
        <Section title={strings.ministry.waterfallTitle} help={strings.ministry.waterfallHelp}>
          <AllocationWaterfall
            chartId="ministry_waterfall"
            steps={steps}
            ariaLabel={`${strings.ministry.waterfallTitle}, ${ministry.name}, ${fy}`}
          />
        </Section>

        <Section title={strings.ministry.monthlyTitle} help={strings.ministry.monthlyHelp}>
          {/* Rows are not values. A source that has published one cumulative
              figure yields one month whose own spend cannot be recovered, and
              the chart drew an axis label above an empty plot. An empty chart
              is worse than no chart: it looks like a rendering failure rather
              than like a source that has not published enough yet. */}
          {hasMonthlyValues ? (
            <MonthlySpendChart
              chartId="ministry_monthly_spend"
              points={bars}
              priorPoints={priorBars}
              ariaLabel={`${strings.ministry.monthlyTitle}, ${ministry.name}, ${fy}`}
            />
          ) : (
            <EmptyState
              icon={BarChart3}
              title={strings.ministry.emptyTitle}
              body={strings.ministry.monthlyEmpty}
            />
          )}
        </Section>

        <Section title={strings.ministry.splitTitle} help={strings.ministry.splitHelp}>
          {isNotReported(splitTotal) ? (
            <p className="text-[13px] text-[color:var(--color-ink-faint)]">
              {strings.ministry.splitEmpty}
            </p>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2">
              <FigureBlock
                label={strings.ministry.revenueLabel}
                value={ministry.revenueExpenditure}
                scale="lead"
                provenance={ministry.provenance.expenditure}
                metric={strings.ministry.revenueLabel}
                entityId={ministry.ministryId}
                stage="EXPENDITURE"
                note={formatPercent(revenueShare)}
              />
              <FigureBlock
                label={strings.ministry.capitalLabel}
                value={ministry.capitalExpenditure}
                scale="lead"
                provenance={ministry.provenance.expenditure}
                metric={strings.ministry.capitalLabel}
                entityId={ministry.ministryId}
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

        <Section title={strings.ministry.yoyTitle} help={strings.ministry.yoyHelp}>
          {yoyRows.length > 1 ? (
            <YoyAllocationChart
              chartId="ministry_yoy_allocation"
              rows={yoyRows}
              ariaLabel={`${strings.ministry.yoyTitle}, ${ministry.name}`}
            />
          ) : (
            <p className="text-[13px] text-[color:var(--color-ink-faint)]">
              {strings.ministry.yoyEmpty}
            </p>
          )}
        </Section>
      </PageShell>
    </>
  );
}

function toPlain(value: MinistrySummary['be']): number | null {
  return isNotReported(value) ? null : value;
}

function negate(value: MinistrySummary['be']): number | null {
  return isNotReported(value) ? null : -value;
}

/* ------------------------------------------------------------------ *
 * Schemes
 * ------------------------------------------------------------------ */

async function SchemesTab({ ministryId, fy }: { ministryId: string; fy: string }) {
  const strings = await getStrings();
  let schemes: SchemeSummary[] = [];
  try {
    schemes = await listSchemeSummaries(fy, { ministryId, orderBy: 'allocation', limit: 300 });
  } catch (error) {
    console.error('[ministry] could not load schemes', error);
  }

  return (
    <PageShell>
      <Section title={strings.ministry.schemesTitle} help={strings.scheme.stagesHelp}>
        {schemes.length === 0 ? (
          <EmptyState
            icon={Layers}
            title={strings.ministry.schemesEmptyTitle}
            body={strings.ministry.schemesEmptyBody}
          />
        ) : (
          <TableScroll>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{strings.ministry.schemesCol.name}</th>
                  <th scope="col">{strings.ministry.schemesCol.type}</th>
                  <th scope="col" className="num">
                    {strings.ministry.schemesCol.allocation}
                  </th>
                  <th scope="col" className="num">
                    {strings.ministry.schemesCol.released}
                  </th>
                  <th scope="col" className="num">
                    {strings.ministry.schemesCol.utilized}
                  </th>
                  <th scope="col" className="num">
                    {strings.ministry.schemesCol.utilizationPct}
                  </th>
                  <th scope="col" className="num">
                    {strings.ministry.schemesCol.tenders}
                  </th>
                </tr>
              </thead>
              <tbody>
                {schemes.map((scheme) => (
                  <tr key={scheme.schemeId}>
                    <td className="max-w-[24rem]">
                      <Link
                        href={`/scheme/${encodeURIComponent(scheme.schemeId)}?fy=${fy}`}
                        className="underline decoration-[color:var(--color-rule-strong)] underline-offset-2 transition-colors hover:text-[color:var(--color-behind)]"
                      >
                        {scheme.name}
                      </Link>
                    </td>
                    <td className="text-[13px] text-[color:var(--color-ink-faint)]">
                      {scheme.schemeType ?? strings.common.notStated}
                    </td>
                    <td className="num">
                      <Figure
                        value={scheme.allocation}
                        scale="dense"
                        provenance={scheme.provenance.allocation}
                        metric={strings.common.allocation}
                        entityId={scheme.schemeId}
                        stage="BE"
                      />
                    </td>
                    <td className="num">
                      <Figure
                        value={scheme.released}
                        scale="dense"
                        provenance={scheme.provenance.released}
                        metric={FISCAL_STAGE_LABELS.RELEASE}
                        entityId={scheme.schemeId}
                        stage="RELEASE"
                      />
                    </td>
                    <td className="num">
                      <Figure
                        value={scheme.utilized}
                        scale="dense"
                        provenance={scheme.provenance.utilized}
                        metric={FISCAL_STAGE_LABELS.UTILIZATION}
                        entityId={scheme.schemeId}
                        stage="UTILIZATION"
                      />
                    </td>
                    <td className="num text-[13px]">
                      <span className="figure">{formatPercent(scheme.utilizationPct)}</span>
                    </td>
                    <td className="num text-[13px]">{scheme.tenderCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
        <Callout tone="caution" title={strings.flags.doesNotProve}>
          {strings.scheme.noUtilisation}
        </Callout>
      </Section>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ *
 * Verification
 * ------------------------------------------------------------------ */

async function VerificationTab({ ministryId, fy }: { ministryId: string; fy: string }) {
  const [strings, locale] = await Promise.all([getStrings(), getLocale()]);
  let report: VerificationReport | null = null;
  try {
    report = await getLatestVerificationReport('ministry', ministryId, fy);
  } catch (error) {
    console.error('[ministry] could not load verification report', error);
  }

  return (
    <PageShell>
      <Section title={strings.verification.title}>
        {!report ? (
          <EmptyState
            icon={FileSearch}
            title={strings.verification.title}
            body={strings.verification.empty}
          />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Chip tone="seal">{strings.verification.aiLabel}</Chip>
              <span className="text-[13px] text-[color:var(--color-ink-faint)]">
                {strings.verification.generated} {formatIstDateTime(report.generatedAt, locale)}
              </span>
            </div>

            <Callout tone="caution">{AI_NARRATIVE_NOTICE}</Callout>

            <div className="prose-civic mt-5">
              {report.narrativeMd
                .split(/\n{2,}/)
                .map((paragraph) => paragraph.trim())
                .filter(Boolean)
                .map((paragraph, index) => (
                  <p key={index}>{paragraph.replace(/^#+\s*/, '')}</p>
                ))}
            </div>

            {report.citations.length > 0 ? (
              <div className="mt-8">
                <p className="eyebrow mb-2">{strings.flags.evidence}</p>
                <ol className="space-y-2 text-[13px]">
                  {report.citations.map((citation) => (
                    <li key={citation.n} className="flex gap-2">
                      <span className="figure text-[color:var(--color-seal)]">{citation.n}</span>
                      <span>
                        {citation.url ? (
                          <a
                            href={citation.url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="underline decoration-[color:var(--color-rule-strong)] underline-offset-2"
                          >
                            {citation.title}
                          </a>
                        ) : (
                          citation.title
                        )}
                        {citation.date ? (
                          <span className="ml-2 text-[color:var(--color-ink-faint)]">
                            {formatIstDate(citation.date, locale)}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </>
        )}
      </Section>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ *
 * Signals
 * ------------------------------------------------------------------ */

async function FlagsTab({ ministryId, fy }: { ministryId: string; fy: string }) {
  const [strings, locale] = await Promise.all([getStrings(), getLocale()]);
  let flags: AnomalyFlag[] = [];
  try {
    flags = await listFlags({ fy, entityType: 'ministry', entityId: ministryId, limit: 50 });
  } catch (error) {
    console.error('[ministry] could not load signals', error);
  }

  return (
    <PageShell>
      <Section title={strings.flags.title} help={strings.flags.intro}>
        {flags.length === 0 ? (
          <EmptyState
            icon={AlertTriangle}
            title={strings.ministry.flagsEmptyTitle}
            body={strings.flags.empty}
          />
        ) : (
          <div className="register border-t border-[color:var(--color-rule)]">
            {flags.map((flag) => {
              const rule = ANOMALY_RULES[flag.ruleId];
              return (
                <article key={flag.flagId} className="py-5">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Chip tone="seal">{flag.severity}</Chip>
                    <Chip tone="muted">{rule.label}</Chip>
                    <span className="text-[11px] text-[color:var(--color-ink-faint)]">
                      {formatIstDate(flag.createdAt, locale)}
                    </span>
                  </div>
                  <p className="max-w-[70ch] text-[14px] leading-relaxed">{flag.explanation}</p>
                  <p className="mt-2 max-w-[70ch] text-[12px] leading-relaxed text-[color:var(--color-ink-faint)]">
                    <span className="eyebrow block">{strings.flags.doesNotProve}</span>
                    {rule.doesNotProve}
                  </p>
                  {flag.evidence.length > 0 ? (
                    <ul className="mt-3 space-y-1 text-[13px]">
                      {flag.evidence.map((item) => (
                        <li key={item.evidenceId}>
                          {item.url ? (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              className="underline decoration-[color:var(--color-rule-strong)] underline-offset-2"
                            >
                              {item.title}
                            </a>
                          ) : (
                            item.title
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </Section>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ *
 * Data and sources
 * ------------------------------------------------------------------ */

async function SourcesTab({ ministry, fy }: { ministry: MinistrySummary; fy: string }) {
  const [strings, locale] = await Promise.all([getStrings(), getLocale()]);
  let monthly: MonthlySpendPoint[] = [];
  let registry: SourceRegistryEntry[] = [];
  try {
    [monthly, registry] = await Promise.all([
      getMonthlySpend('ministry', ministry.ministryId, fy),
      listSourceRegistry(),
    ]);
  } catch (error) {
    console.error('[ministry] could not load source records', error);
  }

  const records = new Map<number, Provenance>();
  for (const record of [ministry.provenance.authority, ministry.provenance.expenditure]) {
    if (record) records.set(record.sourceRecordId, record);
  }
  for (const point of monthly) {
    if (point.provenance) records.set(point.provenance.sourceRecordId, point.provenance);
  }
  const provenanceRows = [...records.values()];
  const usedSourceIds = new Set(provenanceRows.map((record) => record.sourceId));
  const usedRegistry = registry.filter((entry) => usedSourceIds.has(entry.sourceId));

  return (
    <PageShell>
      <Section title={strings.ministry.sourcesTitle} help={strings.ministry.sourcesHelp}>
        {provenanceRows.length === 0 ? (
          <EmptyState
            icon={Library}
            title={strings.ministry.emptyTitle}
            body={strings.ministry.sourcesEmpty}
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

      {usedRegistry.length > 0 ? (
        <Section title={strings.ministry.registryTitle} help={strings.ministry.registryHelp}>
          <TableScroll>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{strings.ministry.registryCol.source}</th>
                  <th scope="col">{strings.ministry.registryCol.tier}</th>
                  <th scope="col">{strings.ministry.registryCol.cadence}</th>
                  <th scope="col">{strings.ministry.registryCol.method}</th>
                  <th scope="col">{strings.ministry.registryCol.licence}</th>
                </tr>
              </thead>
              <tbody>
                {usedRegistry.map((entry) => (
                  <tr key={entry.sourceId}>
                    <td>
                      <a
                        href={entry.homepageUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="underline decoration-[color:var(--color-rule-strong)] underline-offset-2"
                      >
                        {entry.name}
                      </a>
                    </td>
                    <td className="text-[13px]">{entry.tier}</td>
                    <td className="text-[13px]">{entry.cadence}</td>
                    <td className="text-[13px]">{entry.method}</td>
                    <td className="max-w-[32rem] text-[12px] leading-snug text-[color:var(--color-ink-faint)]">
                      {entry.licenseNote}
                      {entry.accessNote ? ` ${entry.accessNote}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Section>
      ) : null}
    </PageShell>
  );
}
