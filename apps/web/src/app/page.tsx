import type { Metadata } from 'next';
import { AlertTriangle, ArrowRight, BarChart3, Landmark, Scale } from 'lucide-react';
import {
  ANOMALY_RULES,
  BURN_BAND_LABELS,
  burnBand,
  burnColor,
  formatINRCr,
  formatPercent,
  isNotReported,
  isReported,
  percentOf,
  subtract,
  type AnomalyFlag,
  type MinistrySummary,
} from '@nidhi/core';
import {
  getMonthlySpend,
  getNationalSummary,
  listFlags,
  listMinistrySummaries,
} from '@nidhi/db';
import { AllocationBullets, type BulletRow } from '@/components/charts/allocation-bullets';
import { MonthlySpendChart, type MonthlyBar } from '@/components/charts/monthly-spend-chart';
import { Figure } from '@/components/figure';
import { HeroPace } from '@/components/hero-pace';
import { Icon } from '@/components/icon';
import { Link } from '@/components/locale-link';
import {
  Callout,
  Chip,
  EmptyState,
  PageShell,
  Section,
  TableScroll,
} from '@/components/layout-primitives';
import { PaceLegend } from '@/components/pace-track';
import { formatFiscalYearLong, formatIstDate } from '@/lib/format';
import { getLocale, getStrings } from '@/lib/i18n-server';
import { resolveFy } from '@/lib/site';

/**
 * P1, the national overview.
 *
 * Everything on this page hangs off one date: the period end of the most recent
 * monthly account. The hero states it before it states any comparison, because
 * a burn figure without the date it was taken on is not a fact, it is a mood.
 */

export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const strings = await getStrings();
  return {
    title: strings.nav.overview,
    description: strings.site.description,
  };
}

type SearchParams = Record<string, string | string[] | undefined>;

/** The national entity in the fiscal fact table. */
const NATIONAL_ENTITY_ID = 'india';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [params, strings, locale] = await Promise.all([searchParams, getStrings(), getLocale()]);

  let fy: string;
  let national: Awaited<ReturnType<typeof getNationalSummary>> = null;
  let ministries: MinistrySummary[] = [];
  let flags: AnomalyFlag[] = [];
  let monthly: Awaited<ReturnType<typeof getMonthlySpend>> = [];
  let degraded = false;

  try {
    const context = await resolveFy(params.fy);
    fy = context.fy;
    [national, ministries, flags, monthly] = await Promise.all([
      getNationalSummary(fy),
      listMinistrySummaries(fy, { orderBy: 'allocation', limit: 200 }),
      listFlags({ fy, limit: 4 }),
      getMonthlySpend('national', NATIONAL_ENTITY_ID, fy),
    ]);
  } catch (error) {
    console.error('[overview] could not load national figures', error);
    fy = 'FY2026';
    degraded = true;
  }

  if (degraded) {
    return (
      <PageShell>
        <EmptyState icon={AlertTriangle} title={strings.degraded.title} body={strings.degraded.body} />
      </PageShell>
    );
  }

  if (!national) {
    return (
      <PageShell>
        <header className="mb-8 border-b-2 border-[color:var(--color-rule-strong)] pb-5">
          <p className="eyebrow mb-1.5">{strings.overview.heroEyebrow}</p>
          <h1 className="font-display text-[clamp(1.75rem,4vw,2.75rem)] leading-[1.1]">
            {strings.overview.heroTitle}
          </h1>
        </header>
        <EmptyState
          icon={Landmark}
          title={strings.overview.emptyTitle}
          body={strings.overview.emptyBody}
          action={{ href: '/methodology', label: strings.nav.methodology }}
        />
      </PageShell>
    );
  }

  const bulletRows: BulletRow[] = ministries
    .filter((ministry) => isReported(ministry.currentAuthority) && ministry.currentAuthority > 0)
    .map((ministry) => ({
      id: ministry.ministryId,
      name: ministry.name,
      authority: isReported(ministry.currentAuthority) ? ministry.currentAuthority : 0,
      spent: isReported(ministry.expenditureToDate) ? ministry.expenditureToDate : null,
      color: burnColor(ministry.burn.burnRatio),
      authorityText: formatINRCr(ministry.currentAuthority),
      spentText: formatINRCr(ministry.expenditureToDate),
      paceText: isReported(ministry.burn.pctSpent)
        ? `${ministry.burn.pctSpent.toFixed(0)}% ${strings.pace.spendMarker.toLowerCase()}`
        : BURN_BAND_LABELS[burnBand(ministry.burn.burnRatio)],
    }));

  // The straight-line tick on every row, as a fraction of the year. Taken from
  // the date the expenditure figures actually cover, not from today: the
  // national summary often has no spend figure at all, in which case the
  // ministries do, and they all share one statement date.
  const parPercent = [national.burn.pctFyElapsed, ...ministries.map((m) => m.burn.pctFyElapsed)]
    .find((value) => isReported(value) && value > 0);
  const parValue = typeof parPercent === 'number' ? parPercent / 100 : null;

  const monthlyBars: MonthlyBar[] = monthly.map((point) => ({
    label: point.label,
    monthly: isNotReported(point.monthly) ? null : point.monthly,
    isProvisional: point.isProvisional,
  }));

  const movers = buildMovers(ministries);

  return (
    <>
      <PageShell>
        <header className="mb-7 border-b-2 border-[color:var(--color-rule-strong)] pb-5">
          <p className="eyebrow mb-1.5">
            {strings.overview.heroEyebrow} · {formatFiscalYearLong(fy, locale)}
          </p>
          <h1 className="font-display text-[clamp(1.75rem,4vw,2.75rem)] leading-[1.1]">
            {strings.overview.heroTitle}
          </h1>
          <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-[color:var(--color-ink-soft)]">
            {strings.site.description}
          </p>
        </header>
      </PageShell>

      <HeroPace
        entityId={NATIONAL_ENTITY_ID}
        authority={national.currentAuthority}
        spent={national.expenditureToDate}
        balance={national.balance}
        burn={national.burn}
        asOf={national.expenditureAsOf}
        authorityProvenance={national.provenance.authority}
        expenditureProvenance={national.provenance.expenditure}
        unit="auto"
        label={strings.site.name}
      />

      <PageShell>
        {/* docs/04 invariant 1: the residual is surfaced, never quietly absorbed. */}
        <div className="mt-8">
          <Callout title={strings.overview.residualLabel}>
            <p>{strings.overview.residualNote}</p>
            <p className="mt-2">
              <Figure
                value={national.ministrySumResidual}
                scale="body"
                signed
                provenance={national.provenance.authority}
                metric={strings.overview.residualLabel}
                entityId={NATIONAL_ENTITY_ID}
                stage="BE"
              />{' '}
              <span className="text-[color:var(--color-ink-faint)]">
                {national.ministryCount} {strings.overview.ministryCount}
              </span>
            </p>
          </Callout>
        </div>

        <Section
          title={strings.overview.treemapTitle}
          help={strings.overview.treemapHelp}
          actions={
            <Link
              href={`/ministries?fy=${fy}`}
              className="inline-flex items-center gap-1.5 text-[13px] text-[color:var(--color-ink-soft)] transition-colors hover:text-[color:var(--color-ink)]"
            >
              {strings.common.viewAll}
              <Icon icon={ArrowRight} size="xs" />
            </Link>
          }
        >
          {bulletRows.length > 0 ? (
            <>
              <AllocationBullets
                rows={bulletRows}
                parFraction={parValue}
                parLabel={strings.pace.calendarMarker}
              />
              <PaceLegend className="mt-4" />
            </>
          ) : (
            <EmptyState
              icon={Landmark}
              title={strings.overview.treemapEmptyTitle}
              body={strings.overview.treemapEmptyBody}
            />
          )}
        </Section>

        <Section title={strings.overview.attentionTitle} help={strings.overview.attentionHelp}>
          {flags.length > 0 ? (
            <div className="grid gap-px bg-[color:var(--color-rule)] sm:grid-cols-2 xl:grid-cols-4">
              {flags.map((flag) => (
                <FlagCard key={flag.flagId} flag={flag} fy={fy} />
              ))}
            </div>
          ) : (
            <EmptyState icon={AlertTriangle} title={strings.flags.empty} body={strings.flags.intro} />
          )}
        </Section>

        <Section title={strings.overview.monthlyTitle} help={strings.overview.monthlyHelp}>
          {monthlyBars.length > 0 ? (
            <MonthlySpendChart
              chartId="overview_monthly_spend"
              points={monthlyBars}
              ariaLabel={`${strings.overview.monthlyTitle}, ${formatFiscalYearLong(fy, locale)}`}
            />
          ) : (
            <EmptyState
              icon={BarChart3}
              title={strings.overview.monthlyEmptyTitle}
              body={strings.overview.monthlyEmptyBody}
            />
          )}
        </Section>

        <Section title={strings.overview.moversTitle} help={strings.overview.moversHelp}>
          {movers.revision.length > 0 || movers.behind.length > 0 || movers.ahead.length > 0 ? (
            <div className="grid gap-8 lg:grid-cols-3">
              <MoverTable
                title={strings.overview.moversRevision}
                fy={fy}
                rows={movers.revision}
              />
              <MoverTable title={strings.overview.moversBehind} fy={fy} rows={movers.behind} />
              <MoverTable title={strings.overview.moversAhead} fy={fy} rows={movers.ahead} />
            </div>
          ) : (
            <EmptyState
              icon={Scale}
              title={strings.overview.moversEmptyTitle}
              body={strings.overview.moversEmptyBody}
            />
          )}
        </Section>

        <p className="mt-10 text-[13px] text-[color:var(--color-ink-faint)]">
          {strings.freshness.asOf} {formatIstDate(national.expenditureAsOf, locale)}.{' '}
          {strings.overview.asOfHelp}
        </p>
      </PageShell>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Movers
 * ------------------------------------------------------------------ */

interface MoverRow {
  ministryId: string;
  name: string;
  primary: string;
  secondary: string;
  accent: string;
}

function buildMovers(ministries: readonly MinistrySummary[]): {
  revision: MoverRow[];
  behind: MoverRow[];
  ahead: MoverRow[];
} {
  // The Amount values are turned into display strings inside the map rather
  // than carried in the intermediate object: a `unique symbol` widens to a bare
  // `symbol` in an object literal and loses the Amount contract.
  const withRevision = ministries
    .map((ministry) => {
      const delta = subtract(ministry.re, ministry.be);
      const pct = percentOf(delta, ministry.be);
      const reported = isReported(delta) && delta !== 0;
      return {
        ministryId: ministry.ministryId,
        name: ministry.name,
        magnitude: isReported(delta) ? Math.abs(delta) : -1,
        reported,
        primary: formatINRCr(delta, { signed: true }),
        secondary: formatPercent(pct, { signed: true }),
        accent: isReported(delta) && delta < 0 ? 'var(--color-behind)' : 'var(--color-ahead)',
      };
    })
    .filter((entry) => entry.reported)
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, 5)
    .map((entry) => ({
      ministryId: entry.ministryId,
      name: entry.name,
      primary: entry.primary,
      secondary: entry.secondary,
      accent: entry.accent,
    }));

  const paced = ministries.filter((ministry) => isReported(ministry.burn.burnRatio));

  const toPaceRow = (ministry: MinistrySummary): MoverRow => ({
    ministryId: ministry.ministryId,
    name: ministry.name,
    primary: formatPercent(ministry.burn.pctSpent),
    secondary: BURN_BAND_LABELS[burnBand(ministry.burn.burnRatio)],
    accent: burnColor(ministry.burn.burnRatio),
  });

  const behind = [...paced]
    .sort((a, b) => Number(a.burn.burnRatio) - Number(b.burn.burnRatio))
    .slice(0, 5)
    .map(toPaceRow);

  const ahead = [...paced]
    .sort((a, b) => Number(b.burn.burnRatio) - Number(a.burn.burnRatio))
    .slice(0, 5)
    .map(toPaceRow);

  return { revision: withRevision, behind, ahead };
}

async function MoverTable({ title, rows, fy }: { title: string; rows: MoverRow[]; fy: string }) {
  const strings = await getStrings();
  return (
    <div>
      <p className="eyebrow mb-2">{title}</p>
      {rows.length === 0 ? (
        <p className="border-t border-[color:var(--color-rule)] pt-3 text-[13px] text-[color:var(--color-ink-faint)]">
          {strings.overview.moversEmptyTitle}
        </p>
      ) : (
        <TableScroll>
          <table className="data-table">
            <tbody>
              {rows.map((row) => (
                <tr key={row.ministryId}>
                  <td className="text-[13px]">
                    <Link
                      href={`/ministry/${encodeURIComponent(row.ministryId)}?fy=${fy}`}
                      className="underline decoration-[color:var(--color-rule-strong)] underline-offset-2 transition-colors hover:text-[color:var(--color-behind)]"
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className="num">
                    <span className="figure text-[13px] font-medium" style={{ color: row.accent }}>
                      {row.primary}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[color:var(--color-ink-faint)]">
                      {row.secondary}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Signals
 * ------------------------------------------------------------------ */

async function FlagCard({ flag, fy }: { flag: AnomalyFlag; fy: string }) {
  const strings = await getStrings();
  const rule = ANOMALY_RULES[flag.ruleId];
  const href =
    flag.entityType === 'scheme'
      ? `/scheme/${encodeURIComponent(flag.entityId)}?fy=${fy}`
      : `/ministry/${encodeURIComponent(flag.entityId)}?fy=${fy}&tab=flags`;

  return (
    <article className="bg-[color:var(--color-paper)] px-4 py-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Chip tone="seal">{flag.severity}</Chip>
        <Chip tone="muted">{rule.label}</Chip>
      </div>
      <h3 className="font-display text-[15px] leading-tight">
        <Link
          href={href}
          className="underline decoration-[color:var(--color-rule-strong)] underline-offset-2 transition-colors hover:text-[color:var(--color-behind)]"
        >
          {flag.entityName}
        </Link>
      </h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-[color:var(--color-ink-soft)]">
        {flag.explanation}
      </p>
      <p className="mt-3 border-t border-[color:var(--color-rule)] pt-2 text-[11px] leading-snug text-[color:var(--color-ink-faint)]">
        <span className="eyebrow block">{strings.flags.doesNotProve}</span>
        {rule.doesNotProve}
      </p>
    </article>
  );
}
