import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Layers } from 'lucide-react';
import {
  formatFiscalYearLong,
  formatPercent,
  isNotReported,
  isReported,
  percentOf,
  type Amount,
  type EvidenceItem,
  type FiscalYear,
  type SchemeSummary,
  type Tender,
} from '@nidhi/core';
import { getSchemeSummary, listEvidence, listTenders } from '@nidhi/db';
import { StageBars, type StageDatum } from '@/components/charts/stage-bars';
import { EvidenceTimeline } from '@/components/evidence-timeline';
import { Figure } from '@/components/figure';
import {
  Callout,
  EmptyState,
  PageHeader,
  PageShell,
  Section,
} from '@/components/layout-primitives';
import { TenderList } from '@/components/tender-list';
import { resolveFy } from '@/lib/site';
import { strings } from '@/lib/strings';

/**
 * P3, the scheme page.
 *
 * The three stages of the same rupee are drawn on one axis with their stage
 * names spelled out, because "allocated", "released" and "utilised" are three
 * different claims and the product's second principle is that they are never
 * conflated. Utilisation is the stage most often absent in Indian scheme data,
 * and absence here is rendered as absence: the words "Not reported", plus the
 * standing note explaining why coverage is partial.
 *
 * Everything below the fiscal section is Tier 2. Tenders and press items are
 * corroborating signal, matched by name, and the components that render them
 * carry that caveat themselves.
 */

export const revalidate = 300;

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/** Narrow an Amount for the client boundary: NOT_REPORTED is a symbol, and a
 *  symbol cannot be serialised into a client component. Absence travels as null
 *  and is rendered as absence on the far side. */
function toNullable(value: Amount): number | null {
  return isReported(value) ? value : null;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  try {
    const { fy } = await resolveFy(first(query.fy));
    const scheme = await getSchemeSummary(fy, id);
    if (!scheme) {
      return { title: strings.scheme.notFoundTitle, robots: { index: false, follow: true } };
    }
    return {
      title: scheme.name,
      description: `${strings.scheme.stagesHelp} ${scheme.name}, ${formatFiscalYearLong(fy)}.`,
    };
  } catch {
    return { title: strings.common.scheme };
  }
}

interface PageData {
  fy: FiscalYear;
  scheme: SchemeSummary;
  tenders: Tender[];
  evidence: EvidenceItem[];
}

export default async function SchemePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  let data: PageData | null = null;
  let missing = false;
  try {
    const { fy } = await resolveFy(first(query.fy));
    const scheme = await getSchemeSummary(fy, id);
    if (!scheme) {
      missing = true;
    } else {
      const [tenders, evidence] = await Promise.all([
        listTenders({ schemeId: id, limit: 25 }),
        listEvidence({ schemeId: id, limit: 25 }),
      ]);
      data = { fy, scheme, tenders, evidence };
    }
  } catch (error) {
    console.error('[scheme] could not load scheme page', error);
  }

  // Only a confirmed absence from the records is a 404. A database that could
  // not be reached says so instead, because "this scheme does not exist" would
  // be a claim we cannot support.
  if (missing) notFound();

  if (!data) {
    return (
      <PageShell>
        <PageHeader title={strings.common.scheme} />
        <EmptyState
          icon={Layers}
          title={strings.scheme.unavailable}
          body={strings.scheme.unavailableBody}
          action={{ href: '/schemes', label: strings.schemes.title }}
        />
      </PageShell>
    );
  }

  const { scheme, fy } = data;
  const releasedPct = percentOf(scheme.released, scheme.allocation);

  const stages: StageDatum[] = [
    { key: 'allocation', label: strings.scheme.stageAllocation, value: toNullable(scheme.allocation) },
    { key: 'released', label: strings.scheme.stageReleased, value: toNullable(scheme.released) },
    { key: 'utilized', label: strings.scheme.stageUtilised, value: toNullable(scheme.utilized) },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow={formatFiscalYearLong(fy)}
        title={scheme.name}
        lede={
          scheme.ministryName
            ? `${strings.common.ministry}: ${scheme.ministryName}`
            : undefined
        }
        actions={
          <Link
            href={`/verify/scheme/${scheme.schemeId}`}
            className="border-b border-[color:var(--color-behind)] pb-0.5 text-[13px] font-medium text-[color:var(--color-behind)]"
          >
            {strings.scheme.verificationCta}
          </Link>
        }
      />

      <nav aria-label={strings.common.scheme} className="no-print -mt-4 mb-8 flex gap-6 border-b border-[color:var(--color-rule)] pb-2">
        <span
          aria-current="page"
          className="border-b-2 border-[color:var(--color-ink)] pb-2 text-[13px] font-medium"
        >
          {strings.scheme.tabOverview}
        </span>
        <Link
          href={`/verify/scheme/${scheme.schemeId}`}
          className="pb-2 text-[13px] text-[color:var(--color-ink-soft)] transition-colors hover:text-[color:var(--color-ink)]"
        >
          {strings.scheme.tabVerification}
        </Link>
      </nav>

      <Section title={strings.scheme.stagesTitle} help={strings.scheme.stagesHelp}>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <StageBars
            chartId="scheme_stages"
            stages={stages}
            ariaLabel={strings.scheme.stageChartLabel}
          />

          {/* The ledger beside the chart: each stage as a record, with the
              source affordance on the figure itself. */}
          <div className="register border-t border-[color:var(--color-rule)]">
            <div className="py-3">
              <p className="eyebrow mb-1">{strings.scheme.stageAllocation}</p>
              <Figure
                value={scheme.allocation}
                scale="lead"
                stage="BE"
                metric="scheme_allocation"
                entityId={scheme.schemeId}
                provenance={scheme.provenance.allocation}
              />
            </div>

            <div className="py-3">
              <p className="eyebrow mb-1">{strings.scheme.stageReleased}</p>
              <Figure
                value={scheme.released}
                scale="lead"
                stage="RELEASE"
                metric="scheme_released"
                entityId={scheme.schemeId}
                provenance={scheme.provenance.released}
              />
              <p className="mt-1 text-xs text-[color:var(--color-ink-faint)]">
                {strings.scheme.releasedPct}: {formatPercent(releasedPct, { decimals: 1, notReportedLabel: strings.common.notReported })}
              </p>
            </div>

            <div className="py-3">
              <p className="eyebrow mb-1">{strings.scheme.stageUtilised}</p>
              <Figure
                value={scheme.utilized}
                scale="lead"
                stage="UTILIZATION"
                metric="scheme_utilized"
                entityId={scheme.schemeId}
                provenance={scheme.provenance.utilized}
              />
              <p className="mt-1 text-xs text-[color:var(--color-ink-faint)]">
                {strings.scheme.utilisationPct}:{' '}
                {formatPercent(scheme.utilizationPct, {
                  decimals: 1,
                  notReportedLabel: strings.common.notReported,
                })}
              </p>
            </div>
          </div>
        </div>

        {isNotReported(scheme.utilized) ? (
          <div className="mt-6">
            <Callout tone="caution" title={strings.common.notReported}>
              {strings.scheme.noUtilisation}
            </Callout>
          </div>
        ) : null}
      </Section>

      <Section
        title={strings.scheme.tendersTitle}
        help={`${strings.scheme.tenderCount}: ${scheme.tenderCount}`}
      >
        <TenderList tenders={data.tenders} emptyBody={strings.scheme.tendersEmpty} />
      </Section>

      <Section title={strings.scheme.evidenceTitle}>
        <EvidenceTimeline items={data.evidence} emptyBody={strings.scheme.evidenceEmpty} />
      </Section>
    </PageShell>
  );
}
