import { describe, expect, it } from 'vitest';
import { NOT_REPORTED } from './money';
import {
  computeVariances,
  parFractionAt,
  summariseVariances,
  variancePosition,
  type VarianceInput,
} from './variance';

/**
 * Variance is the number this product ranks ministries by, so the tests are
 * about what it must never do: invent a position for a ministry that reported
 * nothing, rank on a percentage that ignores size, or net two opposite problems
 * into an average that shows neither.
 */

const PAR = 0.75;

function input(overrides: Partial<VarianceInput> = {}): VarianceInput {
  return {
    entityId: 'min-x',
    name: 'Ministry X',
    authority: 1000,
    spent: 750,
    parFraction: PAR,
    ...overrides,
  };
}

describe('variancePosition', () => {
  it('treats a wide band around the line as in step', () => {
    // Monthly accounting is lumpy; a tight band would flag most of the
    // government most of the time and stop meaning anything.
    expect(variancePosition(1.0)).toBe('near_par');
    expect(variancePosition(0.95)).toBe('near_par');
    expect(variancePosition(1.09)).toBe('near_par');
  });

  it('separates behind from far behind', () => {
    expect(variancePosition(0.8)).toBe('behind');
    expect(variancePosition(0.5)).toBe('far_behind');
  });

  it('separates ahead from far ahead', () => {
    expect(variancePosition(1.2)).toBe('ahead');
    expect(variancePosition(2.0)).toBe('far_ahead');
  });
});

describe('computeVariances', () => {
  it('expresses the gap in rupees against the entity own authority', () => {
    // Half spent where three quarters of the year has gone: 25% of 1000.
    const { variances } = computeVariances([input({ spent: 500 })]);
    expect(variances[0]!.varianceCr).toBeCloseTo(-250, 6);
    expect(variances[0]!.absorption).toBeCloseTo(0.5, 6);
    expect(variances[0]!.paceRatio).toBeCloseTo(0.6667, 3);
  });

  it('ranks a large ministry ahead of a small one with the same percentage gap', () => {
    // The whole reason variance is in rupees: a 10 point gap on 60,000 crore
    // and the same gap on 300 crore are not the same fact about public money.
    const { variances } = computeVariances([
      input({ entityId: 'big', authority: 60_000, spent: 39_000 }),
      input({ entityId: 'small', authority: 300, spent: 195 }),
    ]);
    const byGap = [...variances].sort((a, b) => a.varianceCr - b.varianceCr);
    expect(byGap[0]!.entityId).toBe('big');
    expect(variances[0]!.absorption).toBeCloseTo(variances[1]!.absorption, 6);
  });

  it('drops an entity that reported neither half rather than scoring it zero', () => {
    // Treating "not reported" as no spending would put every unreported
    // ministry at the bottom of a league table, which is an accusation
    // manufactured out of missing data.
    const { variances, skipped } = computeVariances([
      input(),
      input({ entityId: 'quiet', spent: NOT_REPORTED }),
      input({ entityId: 'unfunded', authority: NOT_REPORTED }),
    ]);
    expect(variances).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it('drops a zero authority rather than dividing by it', () => {
    const { variances } = computeVariances([input({ authority: 0 })]);
    expect(variances).toEqual([]);
  });

  it('reports each share of the compared total', () => {
    const { variances } = computeVariances([
      input({ entityId: 'a', authority: 750 }),
      input({ entityId: 'b', authority: 250 }),
    ]);
    expect(variances[0]!.shareOfTotal).toBeCloseTo(0.75, 6);
  });
});

describe('summariseVariances', () => {
  it('keeps behind and ahead apart instead of netting them', () => {
    // A government half far behind and half far ahead nets to nothing and is
    // not the same thing as one that is uniformly on the line.
    const { variances } = computeVariances([
      input({ entityId: 'behind', spent: 500 }),
      input({ entityId: 'ahead', spent: 1000 }),
    ]);
    const totals = summariseVariances(variances);
    expect(totals.behindCr).toBeCloseTo(-250, 6);
    expect(totals.aheadCr).toBeCloseTo(250, 6);
    expect(totals.netVarianceCr).toBeCloseTo(0, 6);
    expect(totals.behindCount).toBe(1);
    expect(totals.aheadCount).toBe(1);
  });

  it('measures concentration by authority', () => {
    const { variances } = computeVariances([
      input({ entityId: 'a', authority: 800 }),
      input({ entityId: 'b', authority: 100 }),
      input({ entityId: 'c', authority: 100 }),
    ]);
    expect(summariseVariances(variances).concentrationTopN(1)).toBeCloseTo(0.8, 6);
  });
});

describe('parFractionAt', () => {
  const start = new Date('2023-04-01');
  const end = new Date('2024-03-31');

  it('reads the calendar at the date the expenditure covers', () => {
    const par = parFractionAt(start, end, '2023-12-31');
    expect(par as number).toBeCloseTo(0.751, 2);
  });

  it('refuses to guess when the period is unknown', () => {
    // Assuming today would compare a December figure against a year that is
    // nearly over, and the comparison would be silently wrong.
    expect(parFractionAt(start, end, null)).toBe(NOT_REPORTED);
    expect(parFractionAt(start, end, 'not a date')).toBe(NOT_REPORTED);
  });
});
