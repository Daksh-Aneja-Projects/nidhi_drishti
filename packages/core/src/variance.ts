/**
 * Variance analysis across ministries.
 *
 * The question every reader actually has is "who is behind, and by how much?",
 * and the honest answer needs three quantities kept apart:
 *
 *   absorption   the share of the authority that has been spent
 *   par          the share of the year that had elapsed on the date the
 *                expenditure figure covers
 *   variance     absorption minus par, expressed in rupees against that
 *                ministry's own authority
 *
 * The third is the one worth publishing, because a percentage gap on a small
 * ministry and the same gap on Defence are not the same fact about public
 * money, and ranking on the percentage alone puts a 300 crore department above
 * a 60,000 crore one.
 *
 * ## What par is, and what it is not
 *
 * Par is a straight line: spend one twelfth of the authority each month. No
 * ministry is required to follow it and many should not. Capital projects pay
 * on milestones, procurement lands in tranches, and transfers to states follow
 * their own release calendar, so a genuinely well-run capital ministry can sit
 * far below par in December and finish the year exactly on budget.
 *
 * So a variance is a question, never a finding. Everything computed here is
 * framed that way: the type is called a variance, the bands are called
 * positions, and nothing in this module returns a judgement. A ministry that is
 * behind par is a ministry worth asking about, and the value of the number is
 * that it tells a reader which question to ask first out of fifty.
 */

import { NOT_REPORTED, isNotReported, type Amount } from './money';

/** Where a ministry sits against the straight line, at the date measured. */
export type VariancePosition = 'far_behind' | 'behind' | 'near_par' | 'ahead' | 'far_ahead';

/**
 * Band edges, as a ratio of absorption to par.
 *
 * `near_par` is deliberately wide. Monthly accounting is lumpy, a single large
 * payment moves a mid-sized ministry several points, and a band tight enough to
 * catch that would flag most of the government most of the time. Ten percent
 * either side of the line is the width at which a position stops being noise.
 */
export const VARIANCE_BANDS: ReadonlyArray<{ position: VariancePosition; upTo: number }> = [
  { position: 'far_behind', upTo: 0.6 },
  { position: 'behind', upTo: 0.9 },
  { position: 'near_par', upTo: 1.1 },
  { position: 'ahead', upTo: 1.4 },
  { position: 'far_ahead', upTo: Number.POSITIVE_INFINITY },
];

export const VARIANCE_POSITION_LABELS: Record<VariancePosition, string> = {
  far_behind: 'Far behind the calendar',
  behind: 'Behind the calendar',
  near_par: 'In step with the calendar',
  ahead: 'Ahead of the calendar',
  far_ahead: 'Far ahead of the calendar',
};

export interface VarianceInput {
  entityId: string;
  name: string;
  sector?: string | null;
  authority: Amount;
  spent: Amount;
  /** Share of the fiscal year elapsed at the expenditure date, 0 to 1. */
  parFraction: number;
}

export interface Variance {
  entityId: string;
  name: string;
  sector: string | null;
  authority: number;
  spent: number;
  /** spent / authority, 0 to 1 (can exceed 1). */
  absorption: number;
  parFraction: number;
  /** absorption / parFraction. 1.0 is exactly on the line. */
  paceRatio: number;
  /**
   * Rupees in crore by which spending differs from the straight line, against
   * this ministry's own authority. Negative means behind.
   */
  varianceCr: number;
  position: VariancePosition;
  /** Share of the total authority across the compared set, 0 to 1. */
  shareOfTotal: number;
}

export function variancePosition(paceRatio: number): VariancePosition {
  for (const band of VARIANCE_BANDS) {
    if (paceRatio < band.upTo) return band.position;
  }
  return 'far_ahead';
}

/**
 * Compute variance for every entity that reports both halves of the comparison.
 *
 * Entities missing either figure are dropped rather than defaulted, and the
 * caller is told how many were dropped: a league table that silently treats
 * "not reported" as zero spending would put every unreported ministry at the
 * bottom and read as an accusation manufactured by the absence of data.
 */
export function computeVariances(inputs: ReadonlyArray<VarianceInput>): {
  variances: Variance[];
  skipped: number;
} {
  const usable = inputs.filter(
    (input) =>
      !isNotReported(input.authority) &&
      !isNotReported(input.spent) &&
      (input.authority as number) > 0 &&
      input.parFraction > 0,
  );

  const totalAuthority = usable.reduce((sum, input) => sum + (input.authority as number), 0);

  const variances = usable.map((input) => {
    const authority = input.authority as number;
    const spent = input.spent as number;
    const absorption = spent / authority;
    const paceRatio = absorption / input.parFraction;
    return {
      entityId: input.entityId,
      name: input.name,
      sector: input.sector ?? null,
      authority,
      spent,
      absorption,
      parFraction: input.parFraction,
      paceRatio,
      // Against its own authority, so the figure is "this many crore more or
      // less than a straight line would have spent by now".
      varianceCr: (absorption - input.parFraction) * authority,
      position: variancePosition(paceRatio),
      shareOfTotal: totalAuthority > 0 ? authority / totalAuthority : 0,
    };
  });

  return { variances, skipped: inputs.length - usable.length };
}

export interface VarianceTotals {
  /** Authority across every entity that reported both halves. */
  authority: number;
  spent: number;
  /** Net rupees behind (negative) or ahead (positive) of the straight line. */
  netVarianceCr: number;
  /** Rupees behind the line, summed over only the entities that are behind. */
  behindCr: number;
  aheadCr: number;
  behindCount: number;
  aheadCount: number;
  nearParCount: number;
  /** Share of total authority held by the largest `n`, 0 to 1. */
  concentrationTopN: (n: number) => number;
}

/**
 * Aggregate the set.
 *
 * `behindCr` and `aheadCr` are reported separately rather than netted, because
 * netting them hides the size of both. A government where half the ministries
 * are far behind and half far ahead nets to roughly zero and is not at all the
 * same thing as one that is uniformly on the line.
 */
export function summariseVariances(variances: ReadonlyArray<Variance>): VarianceTotals {
  const authority = variances.reduce((sum, item) => sum + item.authority, 0);
  const spent = variances.reduce((sum, item) => sum + item.spent, 0);
  const behind = variances.filter((item) => item.varianceCr < 0);
  const ahead = variances.filter((item) => item.varianceCr > 0);
  const byAuthority = [...variances].sort((a, b) => b.authority - a.authority);

  return {
    authority,
    spent,
    netVarianceCr: variances.reduce((sum, item) => sum + item.varianceCr, 0),
    behindCr: behind.reduce((sum, item) => sum + item.varianceCr, 0),
    aheadCr: ahead.reduce((sum, item) => sum + item.varianceCr, 0),
    behindCount: behind.length,
    aheadCount: ahead.length,
    nearParCount: variances.filter((item) => item.position === 'near_par').length,
    concentrationTopN: (n: number) => {
      if (authority <= 0) return 0;
      return byAuthority.slice(0, n).reduce((sum, item) => sum + item.authority, 0) / authority;
    },
  };
}

/**
 * Fraction of the fiscal year elapsed at a date, for use as par.
 *
 * Returns {@link NOT_REPORTED} without a date. An expenditure figure whose
 * period is unknown cannot be compared to a calendar at all, and assuming
 * "today" would silently compare a figure from December against a year that is
 * nearly over.
 */
export function parFractionAt(fyStart: Date, fyEnd: Date, at: string | null): Amount {
  if (!at) return NOT_REPORTED;
  const asOf = new Date(at);
  if (Number.isNaN(asOf.getTime())) return NOT_REPORTED;
  const span = fyEnd.getTime() - fyStart.getTime();
  if (span <= 0) return NOT_REPORTED;
  const elapsed = asOf.getTime() - fyStart.getTime();
  return Math.max(0, Math.min(1, elapsed / span));
}
