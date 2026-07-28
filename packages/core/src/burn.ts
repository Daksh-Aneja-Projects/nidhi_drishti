/**
 * Burn-ratio computation and the diverging colour scale that encodes it.
 *
 * The burn gauge is the product's signature visual, so the mapping from ratio
 * to colour lives here rather than in any one chart component. Every surface
 * that colours by burn reads this module, which is what keeps the treemap, the
 * gauge and the tables telling the same story.
 */

import {
  NOT_REPORTED,
  isNotReported,
  percentOf,
  type Amount,
} from './money';
import { fractionOfFiscalYearElapsed } from './fy';
import type { BurnMetrics } from './types';

/**
 * Compute burn metrics for an entity.
 *
 * `authority` is the live spending permission (RE where it exists, else BE,
 * plus supplementary grants). `expenditure` is the CGA accounted actual.
 * Either being unreported propagates through rather than defaulting to zero.
 */
export function computeBurn(
  authority: Amount,
  expenditure: Amount,
  fy: string,
  asOf: Date,
): BurnMetrics {
  const pctSpent = percentOf(expenditure, authority);
  const pctFyElapsed = fractionOfFiscalYearElapsed(fy, asOf) * 100;
  // Guard the denominator: on 1 April nothing has elapsed and the ratio is
  // undefined rather than infinite.
  const burnRatio =
    isNotReported(pctSpent) || pctFyElapsed === 0 ? NOT_REPORTED : pctSpent / pctFyElapsed;
  return { pctSpent, pctFyElapsed, burnRatio };
}

/** Qualitative bands for the burn ratio, used for labels and legends. */
export type BurnBand =
  | 'not_reported'
  | 'far_behind'
  | 'behind'
  | 'on_pace'
  | 'ahead'
  | 'far_ahead';

export function burnBand(burnRatio: Amount): BurnBand {
  if (isNotReported(burnRatio)) return 'not_reported';
  if (burnRatio < 0.5) return 'far_behind';
  if (burnRatio < 0.85) return 'behind';
  if (burnRatio <= 1.15) return 'on_pace';
  if (burnRatio <= 1.3) return 'ahead';
  return 'far_ahead';
}

export const BURN_BAND_LABELS: Record<BurnBand, string> = {
  not_reported: 'Not reported',
  far_behind: 'Far behind pace',
  behind: 'Behind pace',
  on_pace: 'On pace',
  ahead: 'Ahead of pace',
  far_ahead: 'Far ahead of pace',
};

/**
 * Plain-language reading of the ratio for screen readers and tooltips.
 * Deliberately non-judgemental: behind pace is a description, not an accusation.
 */
export function burnDescription(burnRatio: Amount): string {
  if (isNotReported(burnRatio)) return 'Spending pace cannot be computed from the reported figures.';
  const pct = Math.round(Math.abs(burnRatio - 1) * 100);
  if (pct <= 15) return 'Spending is broadly in line with the share of the year elapsed.';
  return burnRatio < 1
    ? `Spending is running about ${pct}% below the share of the year elapsed.`
    : `Spending is running about ${pct}% above the share of the year elapsed.`;
}

/**
 * Diverging colour scale, colourblind safe.
 *
 * Indigo (behind pace) to brass (ahead of pace), rather than the conventional
 * red to green. Two reasons, in order of importance:
 *
 *  1. Red/green carries a good/bad charge this product must not assert. A
 *     ministry behind pace is not committing a scandal and one ahead of pace is
 *     not succeeding; both are descriptions of timing. Indigo and brass are
 *     drawn from the subject's own material world, ink and seals, and neither
 *     reads as an accusation.
 *  2. Blue against yellow is the safest axis for the common colour vision
 *     deficiencies, where red against green is the worst.
 *
 * The midpoint is the paper tone, so entities on pace recede into the page and
 * only genuine outliers come forward.
 */
/**
 * The pace ramp, tuned for a dark ground.
 *
 * On a light background a scale reads by getting darker towards its extremes.
 * On a dark one that is exactly backwards: the darkest steps sink into the
 * surface and disappear, so the ends of the scale, which are the readings that
 * deserve attention, become the least visible thing on the chart. Inverted
 * here, so the extremes are the brightest and the midpoint is a desaturated
 * slate that recedes.
 *
 * The midpoint receding is the point, not a compromise. On pace is the reading
 * with nothing to look at, and a chart where two thirds of the tiles are quiet
 * is a chart whose outliers announce themselves.
 */
const BURN_SCALE_STOPS: ReadonlyArray<{ at: number; color: string }> = [
  { at: 0.0, color: '#7fb2ff' },
  { at: 0.5, color: '#5b93f5' },
  { at: 0.85, color: '#436fbe' },
  { at: 1.0, color: '#646b7d' },
  { at: 1.15, color: '#a8802f' },
  { at: 1.5, color: '#e0a040' },
  { at: 2.0, color: '#f3bd68' },
];

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/** Colour for a burn ratio. Unreported values get the explicit "no data" hatch tone. */
export function burnColor(burnRatio: Amount): string {
  // Missing data gets a desaturated tone of its own, outside the scale, so it
  // can never be mistaken for a value sitting at the neutral midpoint.
  //
  // Tuned for a filled shape rather than for text: WCAG asks 3:1 of a graphical
  // object against its background, where the `--color-unreported` text token is
  // darker still to clear 4.5:1. Same idea, two jobs.
  if (isNotReported(burnRatio)) return '#7f847d';
  const ratio = Math.max(0, Math.min(2, burnRatio));
  let lower = BURN_SCALE_STOPS[0]!;
  let upper = BURN_SCALE_STOPS[BURN_SCALE_STOPS.length - 1]!;
  for (let i = 0; i < BURN_SCALE_STOPS.length - 1; i += 1) {
    const a = BURN_SCALE_STOPS[i]!;
    const b = BURN_SCALE_STOPS[i + 1]!;
    if (ratio >= a.at && ratio <= b.at) {
      lower = a;
      upper = b;
      break;
    }
  }
  const span = upper.at - lower.at;
  const t = span === 0 ? 0 : (ratio - lower.at) / span;
  const from = hexToRgb(lower.color);
  const to = hexToRgb(upper.color);
  return rgbToHex([
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ]);
}

/** Legend entries for the burn scale, in display order. */
export function burnLegend(): Array<{ band: BurnBand; label: string; color: string; at: number }> {
  return [
    { band: 'far_behind', label: BURN_BAND_LABELS.far_behind, color: burnColor(0.3), at: 0.3 },
    { band: 'behind', label: BURN_BAND_LABELS.behind, color: burnColor(0.7), at: 0.7 },
    { band: 'on_pace', label: BURN_BAND_LABELS.on_pace, color: burnColor(1.0), at: 1.0 },
    { band: 'ahead', label: BURN_BAND_LABELS.ahead, color: burnColor(1.25), at: 1.25 },
    { band: 'far_ahead', label: BURN_BAND_LABELS.far_ahead, color: burnColor(1.7), at: 1.7 },
  ];
}

/**
 * De-cumulate a series of cumulative figures.
 *
 * CGA publishes April-to-month cumulative totals. Monthly spend is the
 * successive difference. Negative results happen when a later publication
 * revises an earlier month downward; docs/04 requires we keep and flag them
 * rather than clamping to zero, because clamping would silently inflate the
 * total and hide the revision.
 */
export function decumulate(
  cumulative: Array<Amount>,
): Array<{ monthly: Amount; isRevisionArtifact: boolean }> {
  const out: Array<{ monthly: Amount; isRevisionArtifact: boolean }> = [];
  let previous: Amount = 0;
  for (const current of cumulative) {
    if (isNotReported(current)) {
      out.push({ monthly: NOT_REPORTED, isRevisionArtifact: false });
      // Poison `previous`, so the first reported month *after* a gap is also
      // unreported. Differencing across the gap would otherwise pile several
      // months of spend onto one month and invent a spike that never happened.
      previous = NOT_REPORTED;
      continue;
    }
    if (isNotReported(previous)) {
      out.push({ monthly: NOT_REPORTED, isRevisionArtifact: false });
      previous = current;
      continue;
    }
    const monthly = current - previous;
    out.push({ monthly, isRevisionArtifact: monthly < 0 });
    previous = current;
  }
  return out;
}
