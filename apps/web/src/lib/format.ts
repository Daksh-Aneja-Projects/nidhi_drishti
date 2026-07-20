import { parseFiscalYear } from '@nidhi/core';
import { getDict, type Locale } from './i18n';

/**
 * Display formatting, locale aware.
 *
 * Timestamps are stored in UTC and displayed in Asia/Kolkata (CLAUDE.md), which
 * has to be pinned explicitly: a server rendering in UTC and a browser in IST
 * would otherwise disagree about which day a document is dated, and React would
 * report a hydration mismatch on the freshness bar of every page.
 *
 * Digit policy (both locales): Latin digits with Indian grouping. Indian
 * government budget documents in Hindi conventionally set Latin digits inside
 * Devanagari text, and every rupee figure on the site is already Latin, so the
 * dates match the figures rather than fighting them. Month NAMES are localised
 * (Devanagari under Hindi) but the numbering system is pinned to 'latn' so no
 * ICU default can quietly switch Hindi to Devanagari digits. IST is preserved in
 * both locales.
 */

const IST = 'Asia/Kolkata';
const INTL_LOCALE: Record<Locale, string> = { en: 'en-IN', hi: 'hi-IN' };

interface DateFormatters {
  date: Intl.DateTimeFormat;
  shortDate: Intl.DateTimeFormat;
  dateTime: Intl.DateTimeFormat;
}

const formatterCache = new Map<Locale, DateFormatters>();

function formatters(locale: Locale): DateFormatters {
  const cached = formatterCache.get(locale);
  if (cached) return cached;
  const base = { timeZone: IST, numberingSystem: 'latn' } as const;
  const built: DateFormatters = {
    date: new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      ...base,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }),
    shortDate: new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      ...base,
      day: 'numeric',
      month: 'short',
    }),
    dateTime: new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      ...base,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }),
  };
  formatterCache.set(locale, built);
  return built;
}

function toDate(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  // A bare calendar day is anchored at UTC midnight so it does not shift a day
  // when the runtime interprets it in a local timezone.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatIstDate(
  value: string | Date | null | undefined,
  locale: Locale = 'en',
): string {
  if (!value) return getDict(locale).common.notStated;
  const date = toDate(value);
  return date ? formatters(locale).date.format(date) : getDict(locale).common.notStated;
}

export function formatIstDateShort(
  value: string | Date | null | undefined,
  locale: Locale = 'en',
): string {
  if (!value) return getDict(locale).common.notStated;
  const date = toDate(value);
  return date ? formatters(locale).shortDate.format(date) : getDict(locale).common.notStated;
}

export function formatIstDateTime(
  value: string | Date | null | undefined,
  locale: Locale = 'en',
): string {
  if (!value) return getDict(locale).common.notStated;
  const date = toDate(value);
  return date ? `${formatters(locale).dateTime.format(date)} IST` : getDict(locale).common.notStated;
}

/**
 * Coarse relative age for the freshness bar: "today", "2 days ago".
 *
 * Deliberately coarse. Government sources publish on monthly and daily cycles,
 * so minute-level precision would suggest a currency the data does not have.
 * The words are held here rather than in the string dictionary because they
 * interleave a Latin number with locale-specific spacing; the digit stays Latin
 * in both locales, matching the money figures.
 */
export function formatAge(hours: number | null, locale: Locale = 'en'): string {
  if (hours === null) return getDict(locale).freshness.never;
  if (hours < 1) return locale === 'hi' ? 'एक घंटे के भीतर' : 'Within the hour';
  if (hours < 24) {
    const h = Math.floor(hours);
    return locale === 'hi' ? `${h} घंटे पहले` : `${h}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days === 1) return locale === 'hi' ? 'कल' : 'Yesterday';
  if (days < 30) return locale === 'hi' ? `${days} दिन पहले` : `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return locale === 'hi' ? 'पिछले माह' : 'Last month';
  return locale === 'hi' ? `${months} माह पहले` : `${months} months ago`;
}

/**
 * Localised long fiscal-year label.
 *
 * English: `FY2026 (Apr 2025 to Mar 2026)`. Hindi keeps the same shape with the
 * fiscal-year term and month names in Devanagari and the years in Latin digits,
 * mirroring how the government writes it: `वित्तीय वर्ष 2026 (अप्रैल 2025 से मार्च 2026)`.
 * The `@nidhi/core` helper is English only and lives in a package this app does
 * not own, so the Hindi form is assembled here rather than there. No em-dashes.
 */
export function formatFiscalYearLong(fy: string, locale: Locale = 'en'): string {
  const endYear = parseFiscalYear(fy);
  const startYear = endYear - 1;
  const monthName = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone: 'UTC',
    month: 'short',
    numberingSystem: 'latn',
  });
  const apr = monthName.format(new Date(Date.UTC(startYear, 3, 1)));
  const mar = monthName.format(new Date(Date.UTC(endYear, 2, 1)));
  if (locale === 'hi') {
    return `वित्तीय वर्ष ${endYear} (${apr} ${startYear} से ${mar} ${endYear})`;
  }
  return `FY${endYear} (${apr} ${startYear} to ${mar} ${endYear})`;
}
