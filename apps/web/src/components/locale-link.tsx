'use client';

import NextLink from 'next/link';
import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import { localePath, type Locale } from '@/lib/i18n';
import { useLocale } from '@/components/locale-provider';

/**
 * A drop-in replacement for `next/link` that keeps the reader in their locale.
 *
 * Under Hindi every in-app href is prefixed with `/hi` so navigation never
 * silently drops back to English. A Hindi reader clicking through the site stays
 * on `/hi/...` for the whole journey. External links, anchors and mailto hrefs
 * pass through untouched. This is the only reason the app imports a Link wrapper
 * instead of `next/link` directly.
 */

type LinkProps = ComponentPropsWithoutRef<typeof NextLink>;

/** Prefix a plain string href for a locale. Non-string hrefs pass through. */
export function localeHref(href: LinkProps['href'], locale: Locale): LinkProps['href'] {
  return typeof href === 'string' ? localePath(href, locale) : href;
}

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function LocaleLink(
  { href, ...props },
  ref,
) {
  const locale = useLocale();
  return <NextLink ref={ref} href={localeHref(href, locale)} {...props} />;
});

export default Link;
