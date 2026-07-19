import { describe, expect, it } from 'vitest';
import { NOT_REPORTED, isNotReported, type Amount } from './money';
import { burnBand, burnColor, burnDescription, burnLegend, computeBurn, decumulate } from './burn';

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('computeBurn', () => {
  it('reports a ratio of 1 when spending tracks the calendar exactly', () => {
    // Half the year elapsed, half the authority spent.
    const burn = computeBurn(1000, 500, 'FY2026', utc('2025-09-30'));
    expect(burn.pctSpent).toBe(50);
    expect(burn.pctFyElapsed).toBeGreaterThan(49);
    expect(burn.pctFyElapsed).toBeLessThan(51);
    expect(burn.burnRatio as number).toBeGreaterThan(0.98);
    expect(burn.burnRatio as number).toBeLessThan(1.02);
  });

  it('flags underspending with a ratio below 1', () => {
    const burn = computeBurn(1000, 200, 'FY2026', utc('2025-09-30'));
    expect(burn.burnRatio as number).toBeLessThan(0.5);
  });

  it('returns not reported when the authority is unknown, rather than zero', () => {
    const burn = computeBurn(NOT_REPORTED, 500, 'FY2026', utc('2025-09-30'));
    expect(burn.pctSpent).toBe(NOT_REPORTED);
    expect(burn.burnRatio).toBe(NOT_REPORTED);
  });

  it('returns not reported when the expenditure is unknown', () => {
    expect(computeBurn(1000, NOT_REPORTED, 'FY2026', utc('2025-09-30')).burnRatio).toBe(
      NOT_REPORTED,
    );
  });

  it('does not divide by a zero elapsed fraction on the eve of the year', () => {
    const burn = computeBurn(1000, 0, 'FY2026', utc('2025-03-31'));
    expect(burn.pctFyElapsed).toBe(0);
    expect(burn.burnRatio).toBe(NOT_REPORTED);
  });

  it('returns not reported when the allocation is zero', () => {
    expect(computeBurn(0, 0, 'FY2026', utc('2025-09-30')).burnRatio).toBe(NOT_REPORTED);
  });
});

describe('burnBand', () => {
  it.each([
    [0.2, 'far_behind'],
    [0.49, 'far_behind'],
    [0.5, 'behind'],
    [0.84, 'behind'],
    [0.85, 'on_pace'],
    [1.15, 'on_pace'],
    [1.2, 'ahead'],
    [1.3, 'ahead'],
    [1.31, 'far_ahead'],
  ])('classifies %s as %s', (ratio, expected) => {
    expect(burnBand(ratio)).toBe(expected);
  });

  it('has a dedicated band for missing data', () => {
    expect(burnBand(NOT_REPORTED)).toBe('not_reported');
  });
});

describe('burnColor', () => {
  it('returns a valid hex colour across the range', () => {
    for (const ratio of [0, 0.3, 0.5, 0.85, 1, 1.15, 1.5, 2, 5]) {
      expect(burnColor(ratio)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('gives missing data its own tone rather than the on-pace tone', () => {
    expect(burnColor(NOT_REPORTED)).not.toBe(burnColor(1));
  });

  it('moves monotonically away from the neutral midpoint', () => {
    expect(burnColor(0.2)).not.toBe(burnColor(1));
    expect(burnColor(1.8)).not.toBe(burnColor(1));
    expect(burnColor(0.2)).not.toBe(burnColor(1.8));
  });

  it('clamps beyond the ends of the scale instead of producing invalid colours', () => {
    expect(burnColor(-5)).toBe(burnColor(0));
    expect(burnColor(99)).toBe(burnColor(2));
  });
});

describe('burnDescription', () => {
  it('describes rather than judges', () => {
    const text = burnDescription(0.4);
    expect(text).toContain('below');
    // docs/08 bans accusatory framing in product copy.
    for (const banned of ['scam', 'fraud', 'siphon', 'corrupt']) {
      expect(text.toLowerCase()).not.toContain(banned);
    }
  });

  it('says so plainly when the pace cannot be computed', () => {
    expect(burnDescription(NOT_REPORTED)).toContain('cannot be computed');
  });
});

describe('burnLegend', () => {
  it('covers every band except the missing-data case', () => {
    const bands = burnLegend().map((entry) => entry.band);
    expect(bands).toEqual(['far_behind', 'behind', 'on_pace', 'ahead', 'far_ahead']);
  });
});

describe('decumulate', () => {
  it('differences successive cumulative figures', () => {
    const result = decumulate([100, 250, 400]);
    expect(result.map((r) => r.monthly)).toEqual([100, 150, 150]);
    expect(result.every((r) => !r.isRevisionArtifact)).toBe(true);
  });

  it('keeps negative months and flags them instead of clamping to zero', () => {
    // A downward revision in month three. Clamping would silently inflate the
    // annual total and hide the revision entirely.
    const result = decumulate([100, 250, 200]);
    expect(result[2]!.monthly).toBe(-50);
    expect(result[2]!.isRevisionArtifact).toBe(true);
  });

  it('does not attribute a gap of several months to a single month', () => {
    const result = decumulate([100, NOT_REPORTED, 400]);
    expect(result[1]!.monthly).toBe(NOT_REPORTED);
    // The month after the gap cannot be isolated, so it is not reported either.
    expect(result[2]!.monthly).toBe(NOT_REPORTED);
  });

  it('cannot isolate the month after a leading gap', () => {
    // If April is missing, May's cumulative figure still contains April's
    // spend, so May's own month cannot be recovered.
    const result = decumulate([NOT_REPORTED, 300]);
    expect(result[0]!.monthly).toBe(NOT_REPORTED);
    expect(result[1]!.monthly).toBe(NOT_REPORTED);
  });

  it('preserves series length', () => {
    const input: Amount[] = [100, NOT_REPORTED, 400, 500];
    expect(decumulate(input)).toHaveLength(input.length);
  });

  it('sums de-cumulated months back to the final cumulative figure', () => {
    const cumulative = [120, 340, 610, 900];
    const monthly = decumulate(cumulative).map((r) => r.monthly);
    expect(monthly.every((m) => !isNotReported(m))).toBe(true);
    const total = (monthly as number[]).reduce((a, b) => a + b, 0);
    expect(total).toBe(900);
  });
});
