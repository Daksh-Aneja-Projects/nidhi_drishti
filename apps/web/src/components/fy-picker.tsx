'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type FiscalYear } from '@nidhi/core';
import { useLocale, useStrings } from '@/components/locale-provider';
import { track } from '@/lib/analytics';
import { formatFiscalYearLong } from '@/lib/format';

/**
 * Financial-year selector.
 *
 * The year lives in the query string rather than in client state so that any
 * view a journalist is looking at is a URL they can paste into a story. Options
 * come from the years that actually hold data, so the picker cannot navigate to
 * an empty page.
 */
export function FyPicker({ fy, available }: { fy: FiscalYear; available: FiscalYear[] }) {
  const strings = useStrings();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (available.length <= 1) return null;

  function onChange(next: string) {
    track('fy_changed', { from: fy, to: next });
    const params = new URLSearchParams(searchParams.toString());
    params.set('fy', next);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <label className="flex items-center gap-2">
      <span className="eyebrow text-[color:var(--color-ink-faint)]">{strings.common.fiscalYear}</span>
      <select
        value={fy}
        onChange={(event) => onChange(event.target.value)}
        aria-label={strings.common.fiscalYear}
        className="figure cursor-pointer border border-[color:var(--color-rule-strong)] bg-[color:var(--color-paper-raised)] px-2 py-1 text-[13px] text-[color:var(--color-ink)]"
      >
        {available.map((year) => (
          <option key={year} value={year}>
            {formatFiscalYearLong(year, locale)}
          </option>
        ))}
      </select>
    </label>
  );
}
