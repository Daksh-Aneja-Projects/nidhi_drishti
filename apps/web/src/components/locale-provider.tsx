'use client';

import { createContext, useContext, useMemo } from 'react';
import type { Strings } from '@/lib/strings';
import { getDict, type Locale } from '@/lib/i18n';

/**
 * Carries the active locale to client components.
 *
 * The server decides the locale (from the URL prefix, via middleware) and seeds
 * this provider once at the root. Client components read the dictionary through
 * `useStrings()` and the locale through `useLocale()`, so a client island shows
 * the same language as the server-rendered page around it, with no second
 * source of truth to drift.
 */

const LocaleContext = createContext<Locale>('en');

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useStrings(): Strings {
  const locale = useContext(LocaleContext);
  return useMemo(() => getDict(locale), [locale]);
}
