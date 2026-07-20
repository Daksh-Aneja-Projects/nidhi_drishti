import { NOT_REPORTED, formatFiscalYearLong, percentOf, subtract } from '@nidhi/core';
import { getSchemeSummary } from '@nidhi/db';
import { OG_CONTENT_TYPE, OG_SIZE, renderShareCard } from '@/lib/og-card';
import { getDataMode, resolveFy } from '@/lib/site';
import { strings } from '@/lib/strings';

/**
 * Per-scheme share card.
 *
 * A scheme has no expenditure series to pace against the calendar, so the track
 * shows releases against the allocation instead. That is a different comparison
 * from the ministry card, and the label says which one it is: releases and
 * expenditure are separate fiscal stages and the card must not blur them just
 * because the visual is the same shape.
 */

export const alt = `${strings.site.name}: scheme allocation, releases and utilisation`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/**
 * Scheme stages, not ministry stages. Allocation and releases are two distinct
 * points in the fiscal pipeline, and money released is not money spent.
 */
const SCHEME_LABELS = {
  authority: strings.common.allocation,
  spent: 'Released',
  balance: 'Not yet released',
};

const schemePaceCaption = ({ spent }: { spent: string }) =>
  `${spent} of the allocation released. Releases are not expenditure.`;

export default async function SchemeOpengraphImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { fy } = await resolveFy();
  const [scheme, dataMode] = await Promise.all([getSchemeSummary(fy, id), getDataMode()]);

  if (!scheme) {
    return renderShareCard({
      eyebrow: strings.site.name,
      title: strings.scheme.notFoundTitle,
      authority: NOT_REPORTED,
      spent: NOT_REPORTED,
      balance: NOT_REPORTED,
      burn: { pctSpent: NOT_REPORTED, pctFyElapsed: 0, burnRatio: NOT_REPORTED },
      asOf: null,
      dataMode,
      labels: SCHEME_LABELS,
      paceCaption: schemePaceCaption,
      bandLabel: null,
      showReferenceMarker: false,
    });
  }

  // Share of the allocation released. Deliberately not called a burn ratio:
  // there is no calendar comparison here, so the marker is placed at 100 and
  // the readout states plainly what is being compared.
  const releasedPct = percentOf(scheme.released, scheme.allocation);

  return renderShareCard({
    eyebrow: `${scheme.ministryName ?? strings.common.scheme} · ${formatFiscalYearLong(fy)}`,
    title: scheme.name,
    authority: scheme.allocation,
    spent: scheme.released,
    balance: subtract(scheme.allocation, scheme.released),
    burn: {
      pctSpent: releasedPct,
      pctFyElapsed: 100,
      burnRatio: releasedPct === NOT_REPORTED ? NOT_REPORTED : (releasedPct as number) / 100,
    },
    asOf: null,
    dataMode,
    labels: SCHEME_LABELS,
    paceCaption: schemePaceCaption,
    bandLabel: null,
    showReferenceMarker: false,
  });
}
