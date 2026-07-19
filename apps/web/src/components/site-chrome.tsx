import Link from 'next/link';
import { Info } from 'lucide-react';
import { DEMO_DATA_NOTICE, SITE_DISCLAIMER, type DataMode, type FiscalYear } from '@nidhi/core';
import { Icon } from '@/components/icon';
import { FyPicker } from '@/components/fy-picker';
import { SearchBox } from '@/components/search-box';
import { strings } from '@/lib/strings';

/**
 * Header, footer, and the illustrative-data banner.
 *
 * The wordmark sets the register the rest of the product plays in: the name in
 * condensed caps beside its Devanagari original, letter-spaced like the heading
 * on a government form.
 */

const NAV_LINKS = [
  { href: '/', label: strings.nav.overview },
  { href: '/ministries', label: strings.nav.ministries },
  { href: '/schemes', label: strings.nav.schemes },
  { href: '/flags', label: strings.nav.flags },
  { href: '/compare', label: strings.nav.compare },
];

export function SiteHeader({ fy, availableFy }: { fy: FiscalYear; availableFy: FiscalYear[] }) {
  return (
    <header className="border-b border-[color:var(--color-rule-strong)] bg-[color:var(--color-paper-raised)]">
      <div className="mx-auto flex max-w-[90rem] flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 sm:px-6">
        <Link href="/" className="group flex items-baseline gap-2.5">
          <span className="font-display text-lg uppercase tracking-[0.14em]">
            {strings.site.name}
          </span>
          <span
            className="text-sm text-[color:var(--color-ink-faint)]"
            lang="hi"
            aria-hidden="true"
          >
            निधि दृष्टि
          </span>
        </Link>

        <nav aria-label="Primary" className="order-3 w-full lg:order-none lg:w-auto">
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-1">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-[13px] text-[color:var(--color-ink-soft)] transition-colors hover:text-[color:var(--color-ink)]"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <SearchBox />
          <FyPicker fy={fy} available={availableFy} />
        </div>
      </div>
    </header>
  );
}

/**
 * Shown on every page whenever illustrative figures are being served.
 *
 * Deliberately loud and not dismissible. A sample figure that escapes into a
 * screenshot without this banner attached is the single worst failure this
 * product could have, so the banner is not something a reader can turn off.
 */
export function DataModeBanner({ mode }: { mode: DataMode }) {
  if (mode !== 'demo') return null;
  return (
    <div
      role="status"
      className="border-b-2 border-[color:var(--color-seal)] bg-[color:var(--color-seal)]/8"
      style={{ backgroundColor: 'color-mix(in srgb, var(--color-seal) 8%, transparent)' }}
    >
      <div className="mx-auto flex max-w-[90rem] items-start gap-2.5 px-4 py-2.5 sm:px-6">
        <Icon
          icon={Info}
          size="sm"
          className="mt-0.5 text-[color:var(--color-seal)]"
        />
        <p className="text-[13px] leading-snug text-[color:var(--color-ink)]">
          <span className="font-medium">Illustrative sample data.</span> {DEMO_DATA_NOTICE}
        </p>
      </div>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t-2 border-[color:var(--color-rule-strong)] bg-[color:var(--color-paper-raised)]">
      <div className="mx-auto max-w-[90rem] px-4 py-8 sm:px-6">
        <div className="grid gap-8 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div>
            <p className="eyebrow mb-2">{strings.footer.disclaimerTitle}</p>
            {/* docs/08 section 3: this text appears on every page. */}
            <p className="max-w-[60ch] text-[13px] leading-relaxed text-[color:var(--color-ink-soft)]">
              {SITE_DISCLAIMER}
            </p>
          </div>

          <nav aria-label="Secondary">
            <ul className="space-y-1.5 text-[13px]">
              <FooterLink href="/methodology">{strings.nav.methodology}</FooterLink>
              <FooterLink href="/sources">{strings.nav.sources}</FooterLink>
              <FooterLink href="/api-docs">{strings.nav.api}</FooterLink>
              <FooterLink href="/corrections">{strings.footer.corrections}</FooterLink>
            </ul>
          </nav>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="text-[color:var(--color-ink-soft)] underline decoration-[color:var(--color-rule-strong)] underline-offset-2 transition-colors hover:text-[color:var(--color-ink)]"
      >
        {children}
      </Link>
    </li>
  );
}
