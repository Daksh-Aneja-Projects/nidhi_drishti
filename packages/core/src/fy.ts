/**
 * India fiscal-year utilities.
 *
 * The Indian FY runs 1 April to 31 March and is labelled by the calendar year in
 * which it *ends*: FY2026 = 2025-04-01 .. 2026-03-31.
 *
 * Quarters are FY-relative, not calendar: Q1 = Apr-Jun, Q2 = Jul-Sep,
 * Q3 = Oct-Dec, Q4 = Jan-Mar.
 *
 * Every function here is pure and UTC-based. Dates are handled as calendar days
 * (no time component) because fiscal documents are day-granular; display-side
 * timezone conversion to Asia/Kolkata is the presentation layer's job.
 */

/** Canonical fiscal-year label, e.g. `FY2026`. */
export type FiscalYear = `FY${number}`;

/** FY-relative quarter. Q1 is April-June. */
export type FiscalQuarter = 1 | 2 | 3 | 4;

export interface FiscalYearRange {
  fy: FiscalYear;
  /** 1 April of the starting calendar year. */
  startDate: Date;
  /** 31 March of the ending calendar year. */
  endDate: Date;
}

const FY_PATTERN = /^FY(\d{4})$/;

export class FiscalYearError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FiscalYearError';
  }
}

/** Build a UTC calendar day, avoiding local-timezone drift. */
function utcDay(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

/** Strip any time component, keeping the UTC calendar day. */
function toUtcDay(date: Date): Date {
  return utcDay(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Parse `FY2026` into the ending calendar year (2026). Throws on bad input. */
export function parseFiscalYear(fy: string): number {
  const match = FY_PATTERN.exec(fy);
  if (!match) {
    throw new FiscalYearError(
      `Invalid fiscal year "${fy}". Expected the form FY2026 (labelled by the year the FY ends).`,
    );
  }
  const endYear = Number(match[1]);
  if (endYear < 1950 || endYear > 2200) {
    throw new FiscalYearError(`Fiscal year "${fy}" is outside the supported range FY1950..FY2200.`);
  }
  return endYear;
}

/** True when the string is a well-formed, in-range FY label. */
export function isFiscalYear(value: string): value is FiscalYear {
  try {
    parseFiscalYear(value);
    return true;
  } catch {
    return false;
  }
}

/** The FY label for a given date. 2025-04-01 and 2026-03-31 both give FY2026. */
export function fiscalYearOf(date: Date): FiscalYear {
  const month = date.getUTCMonth(); // 0 = Jan
  const year = date.getUTCFullYear();
  // Jan/Feb/Mar (0,1,2) belong to the FY labelled with the current year.
  // Apr..Dec belong to the FY labelled with the next year.
  const endYear = month <= 2 ? year : year + 1;
  return `FY${endYear}`;
}

/** Start and end dates for an FY label. */
export function fiscalYearRange(fy: string): FiscalYearRange {
  const endYear = parseFiscalYear(fy);
  return {
    fy: `FY${endYear}`,
    startDate: utcDay(endYear - 1, 3, 1), // 1 April
    endDate: utcDay(endYear, 2, 31), // 31 March
  };
}

/** FY-relative quarter for a date. April is Q1. */
export function fiscalQuarterOf(date: Date): FiscalQuarter {
  const month = date.getUTCMonth();
  // Shift so that April (3) becomes 0, then divide into three-month blocks.
  const fyMonthIndex = (month - 3 + 12) % 12;
  return (Math.floor(fyMonthIndex / 3) + 1) as FiscalQuarter;
}

/** Date range covered by an FY quarter. */
export function fiscalQuarterRange(fy: string, quarter: FiscalQuarter): { start: Date; end: Date } {
  const endYear = parseFiscalYear(fy);
  const startMonthIndex = 3 + (quarter - 1) * 3; // Apr, Jul, Oct, Jan(+12)
  const startYear = endYear - 1 + Math.floor(startMonthIndex / 12);
  const startMonth = startMonthIndex % 12;
  const start = utcDay(startYear, startMonth, 1);
  // First day of the following quarter, minus one day.
  const nextMonthIndex = startMonthIndex + 3;
  const nextYear = endYear - 1 + Math.floor(nextMonthIndex / 12);
  const end = utcDay(nextYear, nextMonthIndex % 12, 1);
  end.setUTCDate(end.getUTCDate() - 1);
  return { start, end };
}

/**
 * Ordinal of a month within the FY: April = 1 .. March = 12.
 * Used to order CGA monthly accounts correctly (they publish Apr-first).
 */
export function fiscalMonthIndex(date: Date): number {
  return ((date.getUTCMonth() - 3 + 12) % 12) + 1;
}

/** The twelve months of an FY, in fiscal order, as first-of-month UTC dates. */
export function fiscalMonths(fy: string): Date[] {
  const { startDate } = fiscalYearRange(fy);
  return Array.from({ length: 12 }, (_, i) =>
    utcDay(startDate.getUTCFullYear(), startDate.getUTCMonth() + i, 1),
  );
}

/** Short label for a fiscal month, e.g. `Apr 2025`. */
export function fiscalMonthLabel(date: Date): string {
  const names = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ] as const;
  return `${names[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Whether a date falls inside the FY (inclusive of both endpoints). */
export function isWithinFiscalYear(date: Date, fy: string): boolean {
  const { startDate, endDate } = fiscalYearRange(fy);
  const day = toUtcDay(date);
  return day >= startDate && day <= endDate;
}

/**
 * Fraction of the FY elapsed at `asOf`, in [0, 1].
 *
 * This is the denominator of the burn ratio, so it is deliberately day-exact
 * (leap years included) rather than month-approximated. Clamped at both ends so
 * a date outside the FY yields 0 or 1 instead of a nonsensical ratio.
 */
export function fractionOfFiscalYearElapsed(fy: string, asOf: Date): number {
  const { startDate, endDate } = fiscalYearRange(fy);
  const day = toUtcDay(asOf);
  // Strictly before the start is 0. The first day itself counts as one elapsed
  // day, so it must not fall into this branch.
  if (day < startDate) return 0;
  if (day >= endDate) return 1;
  const msPerDay = 86_400_000;
  // +1 on both so that the final day counts as fully elapsed.
  const totalDays = (endDate.getTime() - startDate.getTime()) / msPerDay + 1;
  const elapsedDays = (day.getTime() - startDate.getTime()) / msPerDay + 1;
  return elapsedDays / totalDays;
}

/** Percentage form of {@link fractionOfFiscalYearElapsed}, 0..100. */
export function percentOfFiscalYearElapsed(fy: string, asOf: Date): number {
  return fractionOfFiscalYearElapsed(fy, asOf) * 100;
}

/** The FY immediately before the given one. */
export function previousFiscalYear(fy: string): FiscalYear {
  return `FY${parseFiscalYear(fy) - 1}`;
}

/** The FY immediately after the given one. */
export function nextFiscalYear(fy: string): FiscalYear {
  return `FY${parseFiscalYear(fy) + 1}`;
}

/** `count` fiscal years ending at `fy`, oldest first. Useful for YoY charts. */
export function recentFiscalYears(fy: string, count: number): FiscalYear[] {
  const endYear = parseFiscalYear(fy);
  return Array.from({ length: count }, (_, i) => `FY${endYear - count + 1 + i}` as FiscalYear);
}

/**
 * Human display form: `FY2026 (Apr 2025 to Mar 2026)`.
 * No em-dashes anywhere in user-facing copy (docs/06 rule 3).
 */
export function formatFiscalYearLong(fy: string): string {
  const endYear = parseFiscalYear(fy);
  return `FY${endYear} (Apr ${endYear - 1} to Mar ${endYear})`;
}

/** Compact display form used in dense tables: `FY26`. */
export function formatFiscalYearShort(fy: string): string {
  return `FY${String(parseFiscalYear(fy)).slice(-2)}`;
}
