import { describe, expect, it } from 'vitest';
import {
  FiscalYearError,
  fiscalMonthIndex,
  fiscalMonthLabel,
  fiscalMonths,
  fiscalQuarterOf,
  fiscalQuarterRange,
  fiscalYearOf,
  fiscalYearRange,
  formatFiscalYearLong,
  formatFiscalYearShort,
  fractionOfFiscalYearElapsed,
  isFiscalYear,
  isWithinFiscalYear,
  nextFiscalYear,
  parseFiscalYear,
  percentOfFiscalYearElapsed,
  previousFiscalYear,
  recentFiscalYears,
} from './fy';

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('parseFiscalYear', () => {
  it('parses the canonical form', () => {
    expect(parseFiscalYear('FY2026')).toBe(2026);
  });

  it.each(['2026', 'FY26', 'fy2026', 'FY20261', '', 'FYabcd'])('rejects %s', (input) => {
    expect(() => parseFiscalYear(input)).toThrow(FiscalYearError);
  });

  it('rejects years outside the supported range', () => {
    expect(() => parseFiscalYear('FY1800')).toThrow(FiscalYearError);
    expect(() => parseFiscalYear('FY9999')).toThrow(FiscalYearError);
  });

  it('reports well-formedness without throwing', () => {
    expect(isFiscalYear('FY2026')).toBe(true);
    expect(isFiscalYear('FY26')).toBe(false);
  });
});

describe('fiscalYearRange', () => {
  it('spans 1 April to 31 March, labelled by the ending year', () => {
    const { startDate, endDate } = fiscalYearRange('FY2026');
    expect(startDate.toISOString().slice(0, 10)).toBe('2025-04-01');
    expect(endDate.toISOString().slice(0, 10)).toBe('2026-03-31');
  });
});

describe('fiscalYearOf', () => {
  // The boundary cases are where FY bucketing bugs actually live.
  it.each([
    ['2025-03-31', 'FY2025'],
    ['2025-04-01', 'FY2026'],
    ['2025-12-31', 'FY2026'],
    ['2026-01-01', 'FY2026'],
    ['2026-03-31', 'FY2026'],
    ['2026-04-01', 'FY2027'],
  ])('%s falls in %s', (date, expected) => {
    expect(fiscalYearOf(utc(date))).toBe(expected);
  });
});

describe('fiscalQuarterOf', () => {
  it('treats April to June as Q1, not January to March', () => {
    expect(fiscalQuarterOf(utc('2025-04-01'))).toBe(1);
    expect(fiscalQuarterOf(utc('2025-06-30'))).toBe(1);
    expect(fiscalQuarterOf(utc('2025-07-01'))).toBe(2);
    expect(fiscalQuarterOf(utc('2025-10-01'))).toBe(3);
    expect(fiscalQuarterOf(utc('2026-01-01'))).toBe(4);
    expect(fiscalQuarterOf(utc('2026-03-31'))).toBe(4);
  });
});

describe('fiscalQuarterRange', () => {
  it('returns Apr to Jun for Q1', () => {
    const { start, end } = fiscalQuarterRange('FY2026', 1);
    expect(start.toISOString().slice(0, 10)).toBe('2025-04-01');
    expect(end.toISOString().slice(0, 10)).toBe('2025-06-30');
  });

  it('rolls Q4 into the following calendar year', () => {
    const { start, end } = fiscalQuarterRange('FY2026', 4);
    expect(start.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(end.toISOString().slice(0, 10)).toBe('2026-03-31');
  });

  it('covers the whole year with no gaps or overlaps', () => {
    const quarters = ([1, 2, 3, 4] as const).map((q) => fiscalQuarterRange('FY2026', q));
    const { startDate, endDate } = fiscalYearRange('FY2026');
    expect(quarters[0]!.start.getTime()).toBe(startDate.getTime());
    expect(quarters[3]!.end.getTime()).toBe(endDate.getTime());
    for (let i = 0; i < 3; i += 1) {
      const gap = quarters[i + 1]!.start.getTime() - quarters[i]!.end.getTime();
      expect(gap).toBe(86_400_000);
    }
  });
});

describe('fiscalMonthIndex', () => {
  it('numbers April as 1 and March as 12, matching CGA publication order', () => {
    expect(fiscalMonthIndex(utc('2025-04-15'))).toBe(1);
    expect(fiscalMonthIndex(utc('2025-12-15'))).toBe(9);
    expect(fiscalMonthIndex(utc('2026-03-15'))).toBe(12);
  });
});

describe('fiscalMonths', () => {
  it('lists twelve months starting in April', () => {
    const months = fiscalMonths('FY2026');
    expect(months).toHaveLength(12);
    expect(fiscalMonthLabel(months[0]!)).toBe('Apr 2025');
    expect(fiscalMonthLabel(months[11]!)).toBe('Mar 2026');
  });
});

describe('isWithinFiscalYear', () => {
  it('includes both endpoints', () => {
    expect(isWithinFiscalYear(utc('2025-04-01'), 'FY2026')).toBe(true);
    expect(isWithinFiscalYear(utc('2026-03-31'), 'FY2026')).toBe(true);
    expect(isWithinFiscalYear(utc('2026-04-01'), 'FY2026')).toBe(false);
    expect(isWithinFiscalYear(utc('2025-03-31'), 'FY2026')).toBe(false);
  });
});

describe('fractionOfFiscalYearElapsed', () => {
  it('is 0 before the year starts and 1 after it ends', () => {
    expect(fractionOfFiscalYearElapsed('FY2026', utc('2025-01-01'))).toBe(0);
    expect(fractionOfFiscalYearElapsed('FY2026', utc('2027-01-01'))).toBe(1);
  });

  it('counts the first day as elapsed and the last day as complete', () => {
    // 365 days in FY2026 (2025-04-01 .. 2026-03-31, no leap day).
    expect(fractionOfFiscalYearElapsed('FY2026', utc('2025-04-01'))).toBeCloseTo(1 / 365, 10);
    expect(fractionOfFiscalYearElapsed('FY2026', utc('2026-03-31'))).toBe(1);
  });

  it('reaches roughly half way at the end of September', () => {
    const half = fractionOfFiscalYearElapsed('FY2026', utc('2025-09-30'));
    expect(half).toBeGreaterThan(0.49);
    expect(half).toBeLessThan(0.51);
  });

  it('accounts for the leap day in a fiscal year that contains one', () => {
    // FY2024 runs 2023-04-01 to 2024-03-31 and contains 2024-02-29: 366 days.
    expect(fractionOfFiscalYearElapsed('FY2024', utc('2023-04-01'))).toBeCloseTo(1 / 366, 10);
  });

  it('expresses the same value as a percentage', () => {
    expect(percentOfFiscalYearElapsed('FY2026', utc('2026-03-31'))).toBe(100);
  });
});

describe('fiscal year navigation', () => {
  it('steps backwards and forwards', () => {
    expect(previousFiscalYear('FY2026')).toBe('FY2025');
    expect(nextFiscalYear('FY2026')).toBe('FY2027');
  });

  it('lists recent years oldest first, ending at the given year', () => {
    expect(recentFiscalYears('FY2026', 5)).toEqual([
      'FY2022',
      'FY2023',
      'FY2024',
      'FY2025',
      'FY2026',
    ]);
  });
});

describe('fiscal year display', () => {
  it('spells out the span without em-dashes', () => {
    const long = formatFiscalYearLong('FY2026');
    expect(long).toBe('FY2026 (Apr 2025 to Mar 2026)');
    expect(long).not.toContain('—');
    expect(long).not.toContain('–');
  });

  it('abbreviates for dense tables', () => {
    expect(formatFiscalYearShort('FY2026')).toBe('FY26');
  });
});
