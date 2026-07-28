'use client';

import NextLink from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Languages } from 'lucide-react';
import { Icon } from '@/components/icon';
import { useStrings } from '@/components/locale-provider';
import { localePath, splitLocalePath, type Locale } from '@/lib/i18n';

/**
 * Language switcher for the site chrome.
 *
 * Two real links rather than a script-driven control, so it works without
 * JavaScript, is keyboard reachable by default, and carries `hreflang` for
 * discovery. Both links preserve the current path and query string: switching
 * language keeps the reader on the same view. No flag icon anywhere, because a
 * flag names a country, not a language, and several countries share each of
 * these languages.
 *
 * The switch itself is not tracked separately: the destination page fires the
 * `page_view` event with a route that already carries the `/hi` prefix, so the
 * change is measured there, exactly as it is for the primary nav links.
 */
export function LanguageToggle() {
  const strings = useStrings();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [active, canonicalPath] = splitLocalePath(pathname ?? '/');
  const query = searchParams?.toString();
  const suffix = query ? `?${query}` : '';

  const hrefFor = (locale: Locale) => `${localePath(canonicalPath, locale)}${suffix}`;

  return (
    <div
      role="group"
      aria-label={strings.language.label}
      className="flex items-center gap-1.5 text-[13px]"
    >
      <Icon
        icon={Languages}
        size="xs"
        className="text-[color:var(--color-ink-faint)]"
        label={strings.language.label}
      />
      <Option
        href={hrefFor('en')}
        hrefLang="en-IN"
        active={active === 'en'}
        label={strings.language.english}
      />
      <span aria-hidden="true" className="text-[color:var(--color-ink-faint)] opacity-60">
        /
      </span>
      <Option
        href={hrefFor('hi')}
        hrefLang="hi-IN"
        active={active === 'hi'}
        label={strings.language.hindi}
        lang="hi"
      />
    </div>
  );
}

function Option({
  href,
  hrefLang,
  active,
  label,
  lang,
}: {
  href: string;
  hrefLang: string;
  active: boolean;
  label: string;
  lang?: string;
}) {
  return (
    <NextLink
      href={href}
      hrefLang={hrefLang}
      lang={lang}
      aria-current={active ? 'true' : undefined}
      className={
        active
          ? 'font-medium text-[color:var(--color-ink)] underline decoration-[color:var(--color-accent)] decoration-2 underline-offset-4'
          : 'text-[color:var(--color-ink-faint)] transition-colors hover:text-[color:var(--color-ink)]'
      }
    >
      {label}
    </NextLink>
  );
}
