import { describe, expect, it } from 'vitest';
import {
  NOT_REPORTED,
  add,
  formatINRAuto,
  formatINRCompact,
  formatINRCr,
  formatINRLakhCr,
  formatPercent,
  groupIndianDigits,
  isNotReported,
  parseAmountCr,
  parseAmountCrSafe,
  percentOf,
  ratio,
  subtract,
  sumReported,
} from './money';

describe('groupIndianDigits', () => {
  it.each([
    ['1', '1'],
    ['12', '12'],
    ['123', '123'],
    ['1234', '1,234'],
    ['12345', '12,345'],
    ['123456', '1,23,456'],
    ['1234567', '12,34,567'],
    ['12345678', '1,23,45,678'],
    ['1234567890', '1,23,45,67,890'],
  ])('groups %s as %s', (input, expected) => {
    expect(groupIndianDigits(input)).toBe(expected);
  });

  it('never produces western grouping', () => {
    expect(groupIndianDigits('12345678')).not.toBe('12,345,678');
  });
});

describe('parseAmountCr', () => {
  it('parses numeric strings from the database without losing precision at scale', () => {
    expect(parseAmountCr('1234567.89')).toBe(1234567.89);
  });

  it('treats absent values as not reported rather than zero', () => {
    expect(parseAmountCr(null)).toBe(NOT_REPORTED);
    expect(parseAmountCr(undefined)).toBe(NOT_REPORTED);
    expect(parseAmountCr('')).toBe(NOT_REPORTED);
    expect(parseAmountCr('   ')).toBe(NOT_REPORTED);
  });

  it('accepts negative amounts, which appear in revisions', () => {
    expect(parseAmountCr('-42.5')).toBe(-42.5);
  });

  it('throws on unparseable input instead of guessing', () => {
    expect(() => parseAmountCr('about 500 crore')).toThrow(TypeError);
    expect(() => parseAmountCr(Number.NaN)).toThrow(TypeError);
    expect(() => parseAmountCr(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it('has a non-throwing variant that degrades to not reported', () => {
    expect(parseAmountCrSafe('rubbish')).toBe(NOT_REPORTED);
  });
});

describe('formatINRCr', () => {
  it('matches the format specified in docs/06', () => {
    expect(formatINRCr(1234567.89)).toBe('₹12,34,567.89 cr');
  });

  it('renders the not-reported label instead of a zero', () => {
    expect(formatINRCr(NOT_REPORTED)).toBe('Not reported');
    expect(formatINRCr(NOT_REPORTED, { notReportedLabel: 'Not published' })).toBe('Not published');
    expect(formatINRCr(0)).toBe('₹0.00 cr');
  });

  it('places the sign outside the rupee symbol', () => {
    expect(formatINRCr(-500)).toBe('-₹500.00 cr');
    expect(formatINRCr(500, { signed: true })).toBe('+₹500.00 cr');
  });

  it('honours decimal, symbol and unit options', () => {
    expect(formatINRCr(1234.5, { decimals: 0 })).toBe('₹1,235 cr');
    expect(formatINRCr(1234.5, { showSymbol: false, showUnit: false })).toBe('1,234.50');
  });
});

describe('formatINRLakhCr', () => {
  it('scales crore into lakh crore for national figures', () => {
    expect(formatINRLakhCr(4832000)).toBe('₹48.32 lakh cr');
  });

  it('propagates not reported', () => {
    expect(formatINRLakhCr(NOT_REPORTED)).toBe('Not reported');
  });
});

describe('formatINRAuto', () => {
  it('switches unit at one lakh crore', () => {
    expect(formatINRAuto(99_999)).toBe('₹99,999.00 cr');
    expect(formatINRAuto(100_000)).toBe('₹1.00 lakh cr');
  });
});

describe('formatINRCompact', () => {
  it('drops decimals for mid-range axis labels', () => {
    expect(formatINRCompact(12_345)).toBe('12,345 cr');
    expect(formatINRCompact(250_000)).toBe('2.50 lakh cr');
    expect(formatINRCompact(NOT_REPORTED)).toBe('');
  });
});

describe('not-reported propagation', () => {
  it('refuses to divide by zero, because no allocation means no meaningful ratio', () => {
    expect(ratio(50, 0)).toBe(NOT_REPORTED);
    expect(percentOf(50, 0)).toBe(NOT_REPORTED);
  });

  it('propagates through arithmetic rather than coercing to zero', () => {
    expect(subtract(100, NOT_REPORTED)).toBe(NOT_REPORTED);
    expect(subtract(NOT_REPORTED, 100)).toBe(NOT_REPORTED);
    expect(add(1, 2, NOT_REPORTED)).toBe(NOT_REPORTED);
    expect(percentOf(NOT_REPORTED, 100)).toBe(NOT_REPORTED);
  });

  it('computes ordinary arithmetic when everything is reported', () => {
    expect(subtract(100, 40)).toBe(60);
    expect(add(1, 2, 3)).toBe(6);
    expect(percentOf(25, 200)).toBe(12.5);
  });

  it('reports how many values a partial sum skipped', () => {
    const result = sumReported([10, NOT_REPORTED, 20, NOT_REPORTED]);
    expect(result).toEqual({ total: 30, counted: 2, skipped: 2 });
  });

  it('narrows correctly through the type guard', () => {
    const value = parseAmountCr('12');
    expect(isNotReported(value)).toBe(false);
  });
});

describe('formatPercent', () => {
  it('renders one decimal by default and never fakes a zero', () => {
    expect(formatPercent(42.35)).toBe('42.4%');
    expect(formatPercent(NOT_REPORTED)).toBe('Not reported');
    expect(formatPercent(-3.2, { signed: true })).toBe('-3.2%');
    expect(formatPercent(3.2, { signed: true })).toBe('+3.2%');
  });
});
