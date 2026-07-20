'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useStrings } from '@/components/locale-provider';

/**
 * Query-string filter bar.
 *
 * Every filter lives in the URL rather than in client state, for the same
 * reason the financial year does: the view a journalist is looking at has to be
 * a link they can paste into a story and a colleague can open unchanged.
 *
 * The controls submit on change and the whole thing degrades to a plain form,
 * so the feed stays filterable without JavaScript.
 */

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterSpec {
  /** Query-string parameter this control writes. */
  name: string;
  label: string;
  /** Current value. The empty string means "no filter". */
  value: string;
  options: FilterOption[];
}

export function FilterBar({ filters }: { filters: FilterSpec[] }) {
  const strings = useStrings();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const active = filters.some((filter) => filter.value !== '');

  function apply(name: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === '') params.delete(name);
    else params.set(name, value);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  function clear() {
    const params = new URLSearchParams(searchParams.toString());
    for (const filter of filters) params.delete(filter.name);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="no-print mb-6 flex flex-wrap items-end gap-x-5 gap-y-3 border-b border-[color:var(--color-rule)] pb-4">
      {filters.map((filter) => (
        <label key={filter.name} className="flex min-w-0 flex-col gap-1">
          <span className="eyebrow">{filter.label}</span>
          <select
            name={filter.name}
            value={filter.value}
            onChange={(event) => apply(filter.name, event.target.value)}
            aria-label={filter.label}
            className="max-w-[16rem] cursor-pointer truncate border border-[color:var(--color-rule-strong)] bg-[color:var(--color-paper)] px-2 py-1 text-[13px] text-[color:var(--color-ink)]"
          >
            {filter.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ))}

      {active ? (
        <button
          type="button"
          onClick={clear}
          className="cursor-pointer border-b border-[color:var(--color-rule-strong)] pb-0.5 text-[12px] text-[color:var(--color-ink-soft)] transition-colors hover:text-[color:var(--color-ink)]"
        >
          {strings.filters.reset}
        </button>
      ) : null}
    </div>
  );
}

/** Named wrapper for the signal feed, so the page reads as what it is. */
export function FlagFilters({ filters }: { filters: FilterSpec[] }) {
  return <FilterBar filters={filters} />;
}
