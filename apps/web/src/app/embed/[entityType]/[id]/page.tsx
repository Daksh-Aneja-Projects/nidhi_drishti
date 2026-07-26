import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  NOT_REPORTED,
  formatPercent,
  isNotReported,
  percentOf,
  subtract,
  type Amount,
  type BurnMetrics,
  type DataMode,
  type Provenance,
} from '@nidhi/core';
import { getMinistrySummary, getSchemeSummary, getStateSummary } from '@nidhi/db';
import { Figure } from '@/components/figure';
import { PaceTrack } from '@/components/pace-track';
import { formatIstDate } from '@/lib/format';
import { localePath } from '@/lib/i18n';
import { getLocale, getStrings } from '@/lib/i18n-server';
import type { Strings } from '@/lib/strings';
import { getDataMode, resolveFy, siteUrl } from '@/lib/site';

/**
 * The newsroom embed (docs/07, the v1.2 line): a compact, self-contained card
 * that sits inside an article column in an iframe.
 *
 * The card carries everything a detached surface needs to stand on its own:
 * the pace comparison, the three headline figures with their stage labels, the
 * date the figures are accounted to, the source attribution, and a link back
 * to the full record. A scheme card compares releases against the allocation
 * rather than spend against the calendar, and says so; the two comparisons are
 * different fiscal stages and are never blurred into one visual grammar.
 *
 * The illustrative-data line matters here more than anywhere else on the site.
 * An embed leaves our chrome behind by design, so when the deployment serves
 * sample figures the card itself says so, in its own first line.
 */

export const revalidate = 300;

const EMBED_ENTITY_TYPES = ['ministry', 'scheme', 'state'] as const;
type EmbedEntityType = (typeof EMBED_ENTITY_TYPES)[number];

type SearchParams = Record<string, string | string[] | undefined>;

function isEmbedEntityType(value: string): value is EmbedEntityType {
  return (EMBED_ENTITY_TYPES as readonly string[]).includes(value);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ entityType: string; id: string }>;
}): Promise<Metadata> {
  const [{ id }, strings] = await Promise.all([params, getStrings()]);
  return {
    title: `${strings.site.name} · ${id}`,
    robots: { index: false, follow: false },
  };
}

interface EmbedCardData {
  name: string;
  /** English-canonical path of the full record. */
  fullPath: string;
  /** The three figures with the stage labels they must carry. */
  figures: Array<{ label: string; value: Amount; provenance: Provenance | null }>;
  /** Calendar comparison, for ministries and states. */
  burn: BurnMetrics | null;
  /** Share of the allocation released, for schemes. */
  releasedPct: Amount | null;
  asOf: string | null;
  sourceNames: string[];
  isState: boolean;
}

async function loadCard(
  entityType: EmbedEntityType,
  id: string,
  fy: string,
  strings: Strings,
): Promise<EmbedCardData | null> {
  if (entityType === 'ministry') {
    const ministry = await getMinistrySummary(fy, id);
    if (!ministry) return null;
    return {
      name: ministry.name,
      fullPath: `/ministry/${encodeURIComponent(id)}`,
      figures: [
        { label: strings.stage.authority, value: ministry.currentAuthority, provenance: ministry.provenance.authority },
        { label: strings.stage.spent, value: ministry.expenditureToDate, provenance: ministry.provenance.expenditure },
        { label: strings.stage.balance, value: ministry.balance, provenance: null },
      ],
      burn: ministry.burn,
      releasedPct: null,
      asOf: ministry.expenditureAsOf,
      sourceNames: sourceNames([ministry.provenance.expenditure, ministry.provenance.authority]),
      isState: false,
    };
  }
  if (entityType === 'state') {
    const state = await getStateSummary(fy, id);
    if (!state) return null;
    return {
      name: state.name,
      fullPath: `/state/${encodeURIComponent(id)}`,
      figures: [
        { label: strings.stage.authority, value: state.currentAuthority, provenance: state.provenance.authority },
        { label: strings.stage.spent, value: state.expenditureToDate, provenance: state.provenance.expenditure },
        { label: strings.stage.balance, value: state.balance, provenance: null },
      ],
      burn: state.burn,
      releasedPct: null,
      asOf: state.expenditureAsOf,
      sourceNames: sourceNames([state.provenance.expenditure, state.provenance.authority]),
      isState: true,
    };
  }
  const scheme = await getSchemeSummary(fy, id);
  if (!scheme) return null;
  return {
    name: scheme.name,
    fullPath: `/scheme/${encodeURIComponent(id)}`,
    figures: [
      { label: strings.common.allocation, value: scheme.allocation, provenance: scheme.provenance.allocation },
      { label: strings.scheme.stageReleased, value: scheme.released, provenance: scheme.provenance.released },
      { label: strings.scheme.stageUtilised, value: scheme.utilized, provenance: scheme.provenance.utilized },
    ],
    burn: null,
    releasedPct: percentOf(scheme.released, scheme.allocation),
    asOf: null,
    sourceNames: sourceNames([
      scheme.provenance.allocation,
      scheme.provenance.released,
      scheme.provenance.utilized,
    ]),
    isState: false,
  };
}

function sourceNames(records: ReadonlyArray<Provenance | null>): string[] {
  return [...new Set(records.filter((record): record is Provenance => record !== null).map((r) => r.sourceName))];
}

export default async function EmbedPage({
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
  if (!isEmbedEntityType(entityType)) notFound();

  let card: EmbedCardData | null = null;
  let fy = 'FY2026';
  let dataMode: DataMode = 'live';
  try {
    const context = await resolveFy(query.fy);
    fy = context.fy;
    [card, dataMode] = await Promise.all([loadCard(entityType, id, fy, strings), getDataMode()]);
  } catch (error) {
    console.error('[embed] could not load the embed record', error);
  }

  if (!card) {
    // A self-contained card, even in absence: an article iframe must never show
    // a bare error page or a site chrome it did not ask for.
    return (
      <EmbedFrame demo={false} strings={strings}>
        <p className="font-display text-base">{strings.embed.unavailableTitle}</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-[color:var(--color-ink-faint)]">
          {strings.embed.unavailableBody}
        </p>
        <p className="mt-4 border-t border-[color:var(--color-rule)] pt-2.5 text-[11px] text-[color:var(--color-ink-faint)]">
          {strings.site.name}
        </p>
      </EmbedFrame>
    );
  }

  const fullUrl = `${siteUrl}${localePath(card.fullPath, locale)}`;
  const releasedKnown = card.releasedPct !== null && !isNotReported(card.releasedPct);
  const releasedPos =
    releasedKnown ? Math.max(0, Math.min(100, card.releasedPct as number)) : 0;

  return (
    <EmbedFrame demo={dataMode === 'demo'} strings={strings}>
      <p className="eyebrow mb-1 text-[10px]">
        {strings.site.name} · {fy}
      </p>
      <h1 className="font-display text-[17px] leading-snug">
        <a
          href={fullUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-[color:var(--color-behind)]"
        >
          {card.name}
        </a>
      </h1>

      <div className="mt-3">
        {card.burn ? (
          <PaceTrack burn={card.burn} size="default" label={card.name} animate={false} />
        ) : (
          <ReleaseBar
            releasedKnown={releasedKnown}
            releasedPos={releasedPos}
            releasedPct={card.releasedPct ?? NOT_REPORTED}
            strings={strings}
          />
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-[color:var(--color-rule)] pt-3">
        {card.figures.map((figure) => (
          <div key={figure.label} className="min-w-0">
            <p className="eyebrow mb-1 text-[9px]">{figure.label}</p>
            <Figure
              value={figure.value}
              unit="auto"
              scale="dense"
              className="text-[14px] font-medium"
              provenance={figure.provenance}
              metric={figure.label}
              entityId={id}
            />
          </div>
        ))}
      </div>

      {card.isState ? (
        <p className="mt-2.5 text-[11px] leading-snug text-[color:var(--color-ink-faint)]">
          {strings.embed.stateLedgerLine}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-[color:var(--color-rule)] pt-2.5">
        <p className="text-[11px] text-[color:var(--color-ink-faint)]">
          {card.asOf ? `${strings.overview.asOfLabel} ${formatIstDate(card.asOf, locale)}. ` : ''}
          {card.sourceNames.length > 0
            ? `${strings.provenance.source}: ${card.sourceNames.join(', ')}.`
            : strings.embed.attribution}
        </p>
        <a
          href={fullUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-medium text-[color:var(--color-behind)] underline decoration-[color:var(--color-rule-strong)] underline-offset-2"
        >
          {strings.embed.openFull}
        </a>
      </div>
    </EmbedFrame>
  );
}

/**
 * The card frame. Padding is tight and the height is bounded by content, so
 * the whole card sits inside the ~360px an article column allows.
 */
function EmbedFrame({
  demo,
  strings,
  children,
}: {
  demo: boolean;
  strings: Strings;
  children: React.ReactNode;
}) {
  return (
    <div className="p-2">
      <div className="mx-auto max-w-[40rem] border border-[color:var(--color-rule-strong)] bg-[color:var(--color-paper-raised)] px-4 py-3.5">
        {demo ? (
          <p className="mb-2.5 border-l-2 border-[color:var(--color-seal)] pl-2 text-[12px] font-medium leading-snug text-[color:var(--color-seal)]">
            {strings.embed.demoNotice}
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/**
 * The scheme comparison: releases against the allocation. Deliberately not the
 * pace track, because there is no calendar in this comparison; the bar carries
 * no band wording and the caption states plainly what is being compared.
 */
function ReleaseBar({
  releasedKnown,
  releasedPos,
  releasedPct,
  strings,
}: {
  releasedKnown: boolean;
  releasedPos: number;
  releasedPct: Amount;
  strings: Strings;
}) {
  return (
    <div>
      <div
        className="relative overflow-hidden"
        style={{ height: 20, backgroundColor: 'var(--color-paper-sunk)' }}
        role="img"
        aria-label={
          releasedKnown
            ? `${formatPercent(releasedPct, { decimals: 1 })} ${strings.embed.releasedShare}`
            : strings.pace.unavailable
        }
      >
        {releasedKnown ? (
          <>
            <div
              className="absolute inset-y-0 left-0"
              style={{ width: `${releasedPos}%`, backgroundColor: 'var(--color-behind)' }}
            />
            <div
              className="hatch absolute inset-y-0"
              style={{ left: `${releasedPos}%`, right: 0, color: 'var(--color-unreported)' }}
            />
          </>
        ) : (
          <div className="hatch absolute inset-0 text-[color:var(--color-unreported)]" />
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-[color:var(--color-ink-soft)]">
        {releasedKnown
          ? `${formatPercent(releasedPct, { decimals: 1 })} ${strings.embed.releasedShare}. ${strings.embed.releasesNotExpenditure}`
          : strings.pace.unavailable}
      </p>
    </div>
  );
}
