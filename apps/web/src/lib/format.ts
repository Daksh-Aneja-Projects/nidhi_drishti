/**
 * Display formatting.
 *
 * Timestamps are stored in UTC and displayed in Asia/Kolkata (CLAUDE.md), which
 * has to be pinned explicitly: a server rendering in UTC and a browser in IST
 * would otherwise disagree about which day a document is dated, and React would
 * report a hydration mismatch on the freshness bar of every page.
 */

const IST = 'Asia/Kolkata';

const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const shortDateFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  day: 'numeric',
  month: 'short',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function toDate(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  // A bare calendar day is anchored at UTC midnight so it does not shift a day
  // when the runtime interprets it in a local timezone.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatIstDate(value: string | Date | null | undefined): string {
  if (!value) return 'Not stated';
  const date = toDate(value);
  return date ? dateFormatter.format(date) : 'Not stated';
}

export function formatIstDateShort(value: string | Date | null | undefined): string {
  if (!value) return 'Not stated';
  const date = toDate(value);
  return date ? shortDateFormatter.format(date) : 'Not stated';
}

export function formatIstDateTime(value: string | Date | null | undefined): string {
  if (!value) return 'Not stated';
  const date = toDate(value);
  return date ? `${dateTimeFormatter.format(date)} IST` : 'Not stated';
}

/**
 * Coarse relative age for the freshness bar: "today", "2 days ago".
 *
 * Deliberately coarse. Government sources publish on monthly and daily cycles,
 * so minute-level precision would suggest a currency the data does not have.
 */
export function formatAge(hours: number | null): string {
  if (hours === null) return 'Not yet fetched';
  if (hours < 1) return 'Within the hour';
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'Last month' : `${months} months ago`;
}
