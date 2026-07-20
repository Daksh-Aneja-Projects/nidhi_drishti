/**
 * Locale plumbing shared by server and client.
 *
 * Two locales: `en` (default, no path prefix) and `hi` (served under a `/hi`
 * path prefix). The prefix is the single source of truth for which language a
 * URL renders, which keeps one URL mapped to exactly one language: good for
 * `hreflang`, for crawlers, and for a link a journalist pastes into a story.
 *
 * This module carries no `next/headers` import so it is safe to pull into a
 * client bundle. The server-only accessor lives in `i18n-server.ts`.
 */

import { strings as en, type Strings } from './strings';
import { strings as hi } from './strings.hi';

export const LOCALES = ['en', 'hi'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Path prefix that selects Hindi. English is served without a prefix. */
export const HI_PREFIX = '/hi';

/** Request header the middleware sets so server components can read the locale. */
export const LOCALE_HEADER = 'x-nidhi-locale';
/** Request header carrying the locale-stripped (English) path, for hreflang. */
export const PATH_HEADER = 'x-nidhi-path';
/** Cookie recording the reader's last explicit choice. */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

/** BCP-47 tags for the `<html lang>` attribute. Region qualified for India. */
export const HTML_LANG: Record<Locale, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
};

const DICTS: Record<Locale, Strings> = { en, hi };

export function isLocale(value: string | null | undefined): value is Locale {
  return value === 'en' || value === 'hi';
}

/** The dictionary for a locale. Falls back to English for anything unexpected. */
export function getDict(locale: Locale): Strings {
  return DICTS[locale] ?? en;
}

/**
 * Prefix an in-app path for a locale. `/ministries` becomes `/hi/ministries`
 * under Hindi, and stays `/ministries` under English. Absolute URLs, anchors
 * and mailto links are returned untouched.
 */
export function localePath(path: string, locale: Locale): string {
  if (locale !== 'hi') return path;
  if (!path.startsWith('/')) return path; // external, hash or mailto
  if (path === '/') return HI_PREFIX;
  if (path === HI_PREFIX || path.startsWith(`${HI_PREFIX}/`)) return path; // already prefixed
  return `${HI_PREFIX}${path}`;
}

/**
 * Split a visible browser path into its locale and the English-canonical path.
 * `/hi/ministries` gives `['hi', '/ministries']`; `/ministries` gives
 * `['en', '/ministries']`.
 */
export function splitLocalePath(pathname: string): [Locale, string] {
  if (pathname === HI_PREFIX) return ['hi', '/'];
  if (pathname.startsWith(`${HI_PREFIX}/`)) return ['hi', pathname.slice(HI_PREFIX.length)];
  return ['en', pathname];
}
