/**
 * Money handling for Indian fiscal figures.
 *
 * Canonical unit everywhere in the system is **INR crore** (1 crore = 10,000,000).
 * Storage is `NUMERIC(20,2)` in Postgres and arrives over the wire as a *string*
 * so no precision is lost in transit; parse it here at the display boundary
 * rather than letting a JSON float through the stack.
 *
 * Display uses the Indian digit-grouping system: the last three digits are one
 * group, and every group above that is two digits. 12345678 renders as
 * 1,23,45,678, not 12,345,678.
 */

/** A money value as it arrives from the database or an API: string, number, or absent. */
export type RawAmount = string | number | null | undefined;

/**
 * Sentinel for a figure that a source genuinely does not report.
 *
 * Principle 1 of CLAUDE.md: never fabricate a number, never interpolate
 * silently. Missing data is a first-class value, not a zero.
 */
export const NOT_REPORTED = Symbol('not_reported');
export type NotReported = typeof NOT_REPORTED;

/** Either a real amount in crore, or an explicit "the source does not report this". */
export type Amount = number | NotReported;

export function isNotReported(value: Amount): value is NotReported {
  return value === NOT_REPORTED;
}

export function isReported(value: Amount): value is number {
  return typeof value === 'number';
}

/**
 * Parse a raw DB/API amount into crore.
 *
 * Returns {@link NOT_REPORTED} for null/undefined/empty, so callers cannot
 * accidentally coerce an unreported figure to 0. Throws on genuinely malformed
 * input, because silently dropping a garbled number is worse than failing loud.
 */
export function parseAmountCr(raw: RawAmount): Amount {
  if (raw === null || raw === undefined) return NOT_REPORTED;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      throw new TypeError(`Non-finite amount: ${raw}`);
    }
    return raw;
  }
  const trimmed = raw.trim();
  if (trimmed === '') return NOT_REPORTED;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`Could not parse amount "${raw}" as a number in crore.`);
  }
  return parsed;
}

/** Parse, treating anything unparseable or absent as unreported rather than throwing. */
export function parseAmountCrSafe(raw: RawAmount): Amount {
  try {
    return parseAmountCr(raw);
  } catch {
    return NOT_REPORTED;
  }
}

/**
 * Group an integer digit string using the Indian system.
 * `"12345678"` becomes `"1,23,45,678"`.
 */
export function groupIndianDigits(digits: string): string {
  if (digits.length <= 3) return digits;
  const lastThree = digits.slice(-3);
  const rest = digits.slice(0, -3);
  // Every group above the final three is two digits wide.
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${grouped},${lastThree}`;
}

export interface FormatOptions {
  /**
   * Decimal places, or `'auto'` (the default): show paise only when the figure
   * actually carries them.
   *
   * The column is NUMERIC(20,2) and some sources do publish to the paise, so
   * the precision has to survive. But most publish whole crore, and padding
   * those to `₹6,23,889.00 cr` puts two meaningless zeros on the largest
   * numbers on the site, which reads as false precision and crowds the figure
   * that matters. Pass a number to pin it.
   */
  decimals?: number | 'auto';
  /** Include the rupee sign. Default true. */
  showSymbol?: boolean;
  /** Include the unit suffix (`cr`, `lakh cr`). Default true. */
  showUnit?: boolean;
  /** Rendered when the value is {@link NOT_REPORTED}. Default "Not reported". */
  notReportedLabel?: string;
  /** Render a leading `+` for positive values. Useful for deltas. Default false. */
  signed?: boolean;
}

const DEFAULTS: Required<FormatOptions> = {
  decimals: 'auto',
  showSymbol: true,
  showUnit: true,
  notReportedLabel: 'Not reported',
  signed: false,
};

/**
 * Resolve `'auto'` against the value.
 *
 * Rounded to the stored scale first: 623888.999999 is a float artefact of a
 * NUMERIC(20,2) round trip, not a figure with paise in it.
 */
function resolveDecimals(decimals: number | 'auto', value: number): number {
  if (decimals !== 'auto') return decimals;
  return Math.round(value * 100) % 100 === 0 ? 0 : 2;
}

function formatNumberIndian(
  value: number,
  decimals: number | 'auto',
  signed: boolean,
): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const fixed = abs.toFixed(resolveDecimals(decimals, abs));
  const [intPart = '0', fracPart] = fixed.split('.');
  const grouped = groupIndianDigits(intPart);
  const body = fracPart ? `${grouped}.${fracPart}` : grouped;
  if (negative) return `-${body}`;
  if (signed) return `+${body}`;
  return body;
}

/**
 * Format an amount in crore: `formatINRCr(1234567.89)` gives `"₹12,34,567.89 cr"`.
 */
export function formatINRCr(value: Amount, options: FormatOptions = {}): string {
  const opts = { ...DEFAULTS, ...options };
  if (isNotReported(value)) return opts.notReportedLabel;
  const number = formatNumberIndian(value, opts.decimals, opts.signed);
  const symbol = opts.showSymbol ? '₹' : '';
  const unit = opts.showUnit ? ' cr' : '';
  // The sign has to sit outside the rupee symbol: -₹5.00 cr, not ₹-5.00 cr.
  if (number.startsWith('-')) return `-${symbol}${number.slice(1)}${unit}`;
  if (number.startsWith('+')) return `+${symbol}${number.slice(1)}${unit}`;
  return `${symbol}${number}${unit}`;
}

/**
 * Format an amount in crore as lakh crore, for national-scale figures.
 * `formatINRLakhCr(4832000)` gives `"₹48.32 lakh cr"`.
 */
export function formatINRLakhCr(value: Amount, options: FormatOptions = {}): string {
  const opts = { ...DEFAULTS, decimals: 2, ...options };
  if (isNotReported(value)) return opts.notReportedLabel;
  const inLakhCr = value / 100_000;
  const number = formatNumberIndian(inLakhCr, opts.decimals, opts.signed);
  const symbol = opts.showSymbol ? '₹' : '';
  const unit = opts.showUnit ? ' lakh cr' : '';
  if (number.startsWith('-')) return `-${symbol}${number.slice(1)}${unit}`;
  if (number.startsWith('+')) return `+${symbol}${number.slice(1)}${unit}`;
  return `${symbol}${number}${unit}`;
}

/**
 * Pick the readable unit automatically: lakh crore above the threshold,
 * plain crore below it. Used by hero figures where the magnitude varies.
 */
export function formatINRAuto(value: Amount, options: FormatOptions = {}): string {
  if (isNotReported(value)) return { ...DEFAULTS, ...options }.notReportedLabel;
  return Math.abs(value) >= 100_000
    ? formatINRLakhCr(value, options)
    : formatINRCr(value, options);
}

/** Compact axis-label form, no symbol, no decimals below 100 crore. */
export function formatINRCompact(value: Amount): string {
  if (isNotReported(value)) return '';
  const abs = Math.abs(value);
  if (abs >= 100_000) return `${formatNumberIndian(value / 100_000, 2, false)} lakh cr`;
  if (abs >= 1_000) return `${formatNumberIndian(value, 0, false)} cr`;
  return `${formatNumberIndian(value, abs < 10 ? 2 : 0, false)} cr`;
}

/**
 * Format a percentage. Returns the not-reported label rather than "0%" when the
 * underlying figure is absent.
 */
export function formatPercent(
  value: Amount,
  options: { decimals?: number; signed?: boolean; notReportedLabel?: string } = {},
): string {
  const { decimals = 1, signed = false, notReportedLabel = 'Not reported' } = options;
  if (isNotReported(value)) return notReportedLabel;
  return `${formatNumberIndian(value, decimals, signed)}%`;
}

/**
 * Safe division that propagates "not reported" instead of producing NaN or
 * Infinity. A zero denominator yields {@link NOT_REPORTED}: an entity with no
 * allocation has no meaningful utilisation percentage, and rendering it as 0%
 * or infinity would both be lies.
 */
export function ratio(numerator: Amount, denominator: Amount): Amount {
  if (isNotReported(numerator) || isNotReported(denominator)) return NOT_REPORTED;
  if (denominator === 0) return NOT_REPORTED;
  return numerator / denominator;
}

/** Percentage of `denominator` represented by `numerator`, or NOT_REPORTED. */
export function percentOf(numerator: Amount, denominator: Amount): Amount {
  const r = ratio(numerator, denominator);
  return isNotReported(r) ? NOT_REPORTED : r * 100;
}

/** Subtraction that propagates "not reported". Used for balance calculations. */
export function subtract(a: Amount, b: Amount): Amount {
  if (isNotReported(a) || isNotReported(b)) return NOT_REPORTED;
  return a - b;
}

/** Addition that propagates "not reported". */
export function add(...values: Amount[]): Amount {
  let total = 0;
  for (const v of values) {
    if (isNotReported(v)) return NOT_REPORTED;
    total += v;
  }
  return total;
}

/**
 * Sum that skips unreported values, reporting how many were skipped.
 *
 * Use only where a partial total is genuinely meaningful and the UI displays the
 * `skipped` count. Never use it to make a chart look complete.
 */
export function sumReported(values: Amount[]): { total: number; counted: number; skipped: number } {
  let total = 0;
  let counted = 0;
  let skipped = 0;
  for (const v of values) {
    if (isNotReported(v)) skipped += 1;
    else {
      total += v;
      counted += 1;
    }
  }
  return { total, counted, skipped };
}
