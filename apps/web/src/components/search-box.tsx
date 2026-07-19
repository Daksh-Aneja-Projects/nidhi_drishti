'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { Icon } from '@/components/icon';
import { track } from '@/lib/analytics';
import { strings } from '@/lib/strings';

interface Hit {
  entityType: 'ministry' | 'scheme';
  entityId: string;
  name: string;
  context: string | null;
}

/**
 * Global search over ministries and schemes.
 *
 * Only the length of the query is ever sent to analytics, never its text
 * (docs/09 privacy stance), which is why the tracked event fires on the result
 * count rather than on the term.
 */
export function SearchBox() {
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = term.trim();
    if (trimmed.length < 2) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    // Debounced so a typed word is one request, not one per keystroke, and so
    // we stay light on our own API.
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = (await response.json()) as { results: Hit[] };
        setHits(data.results);
        setOpen(true);
        track('search_performed', {
          query_len: trimmed.length,
          results_count: data.results.length,
          clicked_rank: null,
        });
      } catch {
        // An aborted or failed lookup leaves the previous results in place
        // rather than blanking the list under the reader.
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [term]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <label className="flex items-center gap-1.5 border border-[color:var(--color-rule-strong)] bg-[color:var(--color-paper)] px-2 py-1">
        <Icon icon={Search} size="sm" className="text-[color:var(--color-ink-faint)]" />
        <span className="sr-only">{strings.nav.search}</span>
        <input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onFocus={() => hits.length > 0 && setOpen(true)}
          placeholder={strings.nav.searchPlaceholder}
          className="w-40 bg-transparent text-[13px] outline-none placeholder:text-[color:var(--color-ink-faint)] focus:w-56 sm:w-52"
        />
      </label>

      {open && hits.length > 0 ? (
        <ul className="absolute right-0 top-full z-50 mt-1 max-h-80 w-80 overflow-y-auto border border-[color:var(--color-rule-strong)] bg-[color:var(--color-paper-raised)] shadow-[0_8px_24px_rgba(22,32,43,0.12)]">
          {hits.map((hit, index) => (
            <li key={`${hit.entityType}-${hit.entityId}`}>
              <Link
                href={`/${hit.entityType}/${hit.entityId}`}
                onClick={() => {
                  track('search_performed', {
                    query_len: term.trim().length,
                    results_count: hits.length,
                    clicked_rank: index + 1,
                  });
                  setOpen(false);
                }}
                className="block border-b border-[color:var(--color-rule)] px-3 py-2 hover:bg-[color:var(--color-paper-sunk)]"
              >
                <span className="block text-[13px] text-[color:var(--color-ink)]">{hit.name}</span>
                <span className="eyebrow">
                  {hit.entityType === 'ministry' ? strings.common.ministry : strings.common.scheme}
                  {hit.context ? ` · ${hit.context}` : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
