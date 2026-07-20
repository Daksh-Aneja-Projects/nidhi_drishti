import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import type { Strings } from './strings';
import { DEFAULT_LOCALE, getDict, isLocale, LOCALE_HEADER, PATH_HEADER, type Locale } from './i18n';

/**
 * Server-side locale accessor.
 *
 * The middleware stamps the resolved locale onto a request header, which every
 * server component reads here rather than through prop drilling. `cache()` keeps
 * it to one header read per request, and because the locale is decided before
 * any component renders there is no flash of English: the server emits Hindi
 * from the first byte.
 */

export const getLocale = cache(async (): Promise<Locale> => {
  const value = (await headers()).get(LOCALE_HEADER);
  return isLocale(value) ? value : DEFAULT_LOCALE;
});

/** The active dictionary for this request. */
export async function getStrings(): Promise<Strings> {
  return getDict(await getLocale());
}

/** The English-canonical path for this request, used to build hreflang links. */
export const getCanonicalPath = cache(async (): Promise<string> => {
  const value = (await headers()).get(PATH_HEADER);
  return value && value.startsWith('/') ? value : '/';
});
