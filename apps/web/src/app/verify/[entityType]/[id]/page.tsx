import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FileSearch } from 'lucide-react';
import {
  AI_NARRATIVE_NOTICE,
  formatPercent,
  subtract,
  type Confidence,
  type EntityType,
  type EvidenceItem,
  type FiscalYear,
  type MinistrySummary,
  type NationalSummary,
  type SchemeSummary,
  type Tender,
  type VerificationReport,
} from '@nidhi/core';
import {
  getLatestVerificationReport,
  getMinistrySummary,
  getNationalSummary,
  getSchemeSummary,
  listEvidence,
  listTenders,
} from '@nidhi/db';
import { EvidenceTimeline, evidenceAnchor, tenderAnchor } from '@/components/evidence-timeline';
import { FigureBlock } from '@/components/figure';
import {
  Callout,
  Chip,
  EmptyState,
  PageHeader,
  PageShell,
} from '@/components/layout-primitives';
import { PaceTrack } from '@/components/pace-track';
import {
  VerificationNarrative,
  VerificationTracker,
  type CitationAnchors,
} from '@/components/verification-narrative';
import { Link } from '@/components/locale-link';
import { formatFiscalYearLong, formatIstDate } from '@/lib/format';
import { getLocale, getStrings } from '@/lib/i18n-server';
import type { Strings } from '@/lib/strings';
import { type Locale } from '@/lib/i18n';
import { resolveFy } from '@/lib/site';

/**
 * P5, the verification view. The page the product exists for.
 *
 * Three columns, and the separation between them is the argument: on the left
 * the official figures with their sources attached, on the right the observable
 * activity around the entity, and between them an AI assembled narrative that
 * may only connect the two by citation. The narrative can never introduce a
 * figure of its own, and every claim it makes carries a numbered chip that links
 * to the item on the right that supports it.
 *
 * When no narrative has been assembled, the two evidence columns still render.
 * The facts and the sources are the product; the narrative is a convenience over
 * them, and its absence must never take them off the screen.
 */

export const revalidate = 300;

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

const ENTITY_TYPES: readonly EntityType[] = ['ministry', 'scheme', 'national'];

function confidenceLabels(strings: Strings): Record<Confidence, string> {
  return {
    high: strings.verification.confidenceHigh,
    medium: strings.verification.confidenceMedium,
    low: strings.verification.confidenceLow,
  };
}

interface Facts {
  name: string;
  href: string | null;
  ministry: MinistrySummary | null;
  national: NationalSummary | null;
  scheme: SchemeSummary | null;
}

interface PageData {
  fy: FiscalYear;
  entityType: EntityType;
  entityId: string;
  facts: Facts | null;
  evidence: EvidenceItem[];
  tenders: Tender[];
  report: VerificationReport | null;
}

async function loadFacts(
  entityType: EntityType,
  entityId: string,
  fy: FiscalYear,
  strings: Strings,
): Promise<Facts | null> {
  if (entityType === 'national') {
    const national = await getNationalSummary(fy);
    if (!national) return null;
    return { name: strings.site.name, href: '/', ministry: null, national, scheme: null };
  }
  if (entityType === 'ministry') {
    const ministry = await getMinistrySummary(fy, entityId);
    if (!ministry) return null;
    return {
      name: ministry.name,
      href: `/ministry/${ministry.ministryId}`,
      ministry,
      national: null,
      scheme: null,
    };
  }
  const scheme = await getSchemeSummary(fy, entityId);
  if (!scheme) return null;
  return {
    name: scheme.name,
    href: `/scheme/${scheme.schemeId}`,
    ministry: null,
    national: null,
    scheme,
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ entityType: string; id: string }>;
}): Promise<Metadata> {
  const [{ entityType, id }, strings] = await Promise.all([params, getStrings()]);
  const valid = ENTITY_TYPES.find((type) => type === entityType);
  if (!valid) {
    return { title: strings.verification.title, robots: { index: false, follow: false } };
  }
  try {
    const { fy } = await resolveFy();
    const facts = await loadFacts(valid, id, fy, strings);
    return {
      title: facts ? `${strings.verification.title}: ${facts.name}` : strings.verification.title,
      description: `${strings.verification.aiLabel}. ${AI_NARRATIVE_NOTICE}`,
      // A narrative is assembled material, not a citable record, so it is kept
      // out of the index while the figures it summarises stay indexable.
      robots: { index: false, follow: true },
    };
  } catch {
    return { title: strings.verification.title, robots: { index: false, follow: true } };
  }
}

export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityType: string; id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ entityType, id }, query, strings, locale] = await Promise.all([
    params,
    searchParams,
    getStrings(),
    getLocale(),
  ]);
  const validType = ENTITY_TYPES.find((type) => type === entityType);
  if (!validType) notFound();
  const confidenceLabelMap = confidenceLabels(strings);

  let data: PageData | null = null;
  try {
    const { fy } = await resolveFy(first(query.fy));
    const facts = await loadFacts(validType, id, fy, strings);
    const scope =
      validType === 'ministry'
        ? { ministryId: id }
        : validType === 'scheme'
          ? { schemeId: id }
          : {};
    const [evidence, tenders, report] = await Promise.all([
      listEvidence({ ...scope, limit: 30 }),
      listTenders({ ...scope, limit: 20 }),
      getLatestVerificationReport(validType, id, fy),
    ]);
    data = { fy, entityType: validType, entityId: id, facts, evidence, tenders, report };
  } catch (error) {
    console.error('[verify] could not load the verification view', error);
  }

  if (!data) {
    return (
      <PageShell>
        <PageHeader title={strings.verification.title} />
        <EmptyState
          icon={FileSearch}
          title={strings.verification.unavailable}
          body={strings.verification.unavailableBody}
          action={{ href: '/', label: strings.nav.overview }}
        />
      </PageShell>
    );
  }

  if (!data.facts) {
    return (
      <PageShell>
        <PageHeader title={strings.verification.title} />
        <EmptyState
          icon={FileSearch}
          title={strings.verification.entityMissing}
          body={strings.verification.entityMissingBody}
          action={{ href: '/ministries', label: strings.nav.ministries }}
        />
      </PageShell>
    );
  }

  const { facts, report } = data;

  // Citations resolve to the item they cite by URL, so a chip in the narrative
  // scrolls to the document on the right rather than to a bare reference list.
  const anchors: CitationAnchors = {};
  if (report) {
    const byUrl = new Map<string, string>();
    for (const item of data.evidence) {
      if (item.url) byUrl.set(item.url, `#${evidenceAnchor(item.evidenceId)}`);
    }
    for (const tender of data.tenders) {
      if (tender.url) byUrl.set(tender.url, `#${tenderAnchor(tender.tenderId)}`);
    }
    for (const citation of report.citations) {
      anchors[citation.n] = byUrl.get(citation.url) ?? `#citation-${citation.n}`;
    }
  }

  const reportAgeDays = report
    ? Math.max(
        0,
        Math.round((Date.now() - new Date(report.generatedAt).getTime()) / 86_400_000),
      )
    : null;

  return (
    <PageShell>
      <VerificationTracker
        entityId={data.entityId}
        cached={report !== null}
        reportAgeDays={reportAgeDays}
      />

      <PageHeader
        eyebrow={`${strings.verification.title} / ${formatFiscalYearLong(data.fy, locale)}`}
        title={facts.name}
        actions={
          facts.href ? (
            <Link
              href={facts.href}
              className="border-b border-[color:var(--color-behind)] pb-0.5 text-[13px] font-medium text-[color:var(--color-behind)]"
            >
              {strings.verification.openEntity}
            </Link>
          ) : undefined
        }
      />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)_minmax(0,20rem)]">
        {/* Left: the official figures. */}
        <section aria-labelledby="facts-heading">
          <h2
            id="facts-heading"
            className="mb-3 border-b border-[color:var(--color-rule-strong)] pb-2 font-display text-lg leading-tight"
          >
            {strings.verification.factsPanel}
          </h2>

          <FactsPanel facts={facts} entityId={data.entityId} strings={strings} locale={locale} />

          <p className="mt-4 max-w-[40ch] text-[12px] leading-relaxed text-[color:var(--color-ink-faint)]">
            {strings.verification.fiscalNote}
          </p>
        </section>

        {/* Centre: the assembled narrative. */}
        <section aria-labelledby="narrative-heading">
          <h2
            id="narrative-heading"
            className="mb-3 border-b border-[color:var(--color-rule-strong)] pb-2 font-display text-lg leading-tight"
          >
            {strings.verification.narrative}
          </h2>

          <Callout tone="caution" title={strings.verification.aiLabel}>
            {AI_NARRATIVE_NOTICE}
            {report ? (
              <span className="mt-1.5 block text-[color:var(--color-ink-faint)]">
                {strings.verification.generated}: {formatIstDate(report.generatedAt, locale)}
                <span className="mx-2">/</span>
                {strings.verification.confidence}: {confidenceLabelMap[report.confidence]}
              </span>
            ) : null}
          </Callout>

          {report ? (
            <>
              <div className="mt-6">
                <VerificationNarrative markdown={report.narrativeMd} anchors={anchors} />
              </div>

              {report.citations.length > 0 ? (
                <div className="mt-8 border-t border-[color:var(--color-rule-strong)] pt-4">
                  <p className="eyebrow mb-2">{strings.verification.citations}</p>
                  <ol className="space-y-2">
                    {report.citations.map((citation) => (
                      <li
                        key={citation.n}
                        id={`citation-${citation.n}`}
                        className="flex gap-3 text-[13px] leading-snug"
                      >
                        <span className="figure shrink-0 text-[color:var(--color-seal)]">
                          {citation.n}
                        </span>
                        <span>
                          {citation.url ? (
                            <a
                              href={citation.url}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              className="underline decoration-[color:var(--color-rule-strong)] underline-offset-2 hover:decoration-[color:var(--color-ink)]"
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
          ) : (
            <div className="mt-6">
              <EmptyState
                icon={FileSearch}
                title={strings.verification.emptyTitle}
                body={`${strings.verification.empty} ${strings.verification.emptyBody}`}
              />
            </div>
          )}
        </section>

        {/* Right: the observable activity. */}
        <section aria-labelledby="evidence-heading">
          <h2
            id="evidence-heading"
            className="mb-3 border-b border-[color:var(--color-rule-strong)] pb-2 font-display text-lg leading-tight"
          >
            {strings.verification.evidencePanel}
          </h2>

          <EvidenceTimeline items={data.evidence} tenders={data.tenders} />
        </section>
      </div>
    </PageShell>
  );
}

/** The fiscal facts, shaped by which kind of entity is being verified. */
function FactsPanel({
  facts,
  entityId,
  strings,
  locale,
}: {
  facts: Facts;
  entityId: string;
  strings: Strings;
  locale: Locale;
}) {
  if (facts.national) {
    const national = facts.national;
    return (
      <div className="register border-t border-[color:var(--color-rule)]">
        <div className="py-3">
          <FigureBlock
            label={strings.stage.authority}
            value={national.currentAuthority}
            unit="auto"
            scale="lead"
            stage="RE"
            metric="national_authority"
            entityId={entityId}
            provenance={national.provenance.authority}
          />
        </div>
        <div className="py-3">
          <FigureBlock
            label={strings.stage.spent}
            value={national.expenditureToDate}
            unit="auto"
            scale="lead"
            stage="EXPENDITURE"
            metric="national_expenditure"
            entityId={entityId}
            provenance={national.provenance.expenditure}
            note={
              national.expenditureAsOf
                ? `${strings.freshness.asOf} ${formatIstDate(national.expenditureAsOf, locale)}`
                : undefined
            }
          />
        </div>
        <div className="py-3">
          <FigureBlock
            label={strings.stage.balance}
            value={national.balance}
            unit="auto"
            scale="lead"
            stage="EXPENDITURE"
            metric="national_balance"
            entityId={entityId}
            provenance={national.provenance.expenditure}
          />
        </div>
        <div className="py-4">
          <p className="eyebrow mb-2">{strings.pace.label}</p>
          <PaceTrack burn={national.burn} animate={false} />
        </div>
      </div>
    );
  }

  if (facts.ministry) {
    const ministry = facts.ministry;
    return (
      <div className="register border-t border-[color:var(--color-rule)]">
        <div className="py-3">
          <FigureBlock
            label={strings.stage.authority}
            value={ministry.currentAuthority}
            scale="lead"
            stage="RE"
            metric="ministry_authority"
            entityId={entityId}
            provenance={ministry.provenance.authority}
          />
        </div>
        <div className="py-3">
          <FigureBlock
            label={strings.stage.spent}
            value={ministry.expenditureToDate}
            scale="lead"
            stage="EXPENDITURE"
            metric="ministry_expenditure"
            entityId={entityId}
            provenance={ministry.provenance.expenditure}
            note={
              ministry.expenditureAsOf
                ? `${strings.freshness.asOf} ${formatIstDate(ministry.expenditureAsOf, locale)}`
                : undefined
            }
          />
        </div>
        <div className="py-3">
          <FigureBlock
            label={strings.stage.balance}
            value={subtract(ministry.currentAuthority, ministry.expenditureToDate)}
            scale="lead"
            stage="EXPENDITURE"
            metric="ministry_balance"
            entityId={entityId}
            provenance={ministry.provenance.expenditure}
          />
        </div>
        <div className="py-4">
          <p className="eyebrow mb-2">{strings.pace.label}</p>
          <PaceTrack burn={ministry.burn} animate={false} />
        </div>
      </div>
    );
  }

  const scheme = facts.scheme;
  if (!scheme) return null;

  return (
    <div className="register border-t border-[color:var(--color-rule)]">
      <div className="py-3">
        <FigureBlock
          label={strings.scheme.stageAllocation}
          value={scheme.allocation}
          scale="lead"
          stage="BE"
          metric="scheme_allocation"
          entityId={entityId}
          provenance={scheme.provenance.allocation}
        />
      </div>
      <div className="py-3">
        <FigureBlock
          label={strings.scheme.stageReleased}
          value={scheme.released}
          scale="lead"
          stage="RELEASE"
          metric="scheme_released"
          entityId={entityId}
          provenance={scheme.provenance.released}
        />
      </div>
      <div className="py-3">
        <FigureBlock
          label={strings.scheme.stageUtilised}
          value={scheme.utilized}
          scale="lead"
          stage="UTILIZATION"
          metric="scheme_utilized"
          entityId={entityId}
          provenance={scheme.provenance.utilized}
          note={`${strings.scheme.utilisationPct}: ${formatPercent(scheme.utilizationPct, {
            decimals: 1,
            notReportedLabel: strings.common.notReported,
          })}`}
        />
      </div>
      <div className="py-3">
        <p className="eyebrow mb-1">{strings.scheme.tenderCount}</p>
        <p className="figure text-base">{scheme.tenderCount}</p>
        <p className="mt-1">
          <Chip tone="muted">{strings.tenders.tier2Title}</Chip>
        </p>
      </div>
    </div>
  );
}
