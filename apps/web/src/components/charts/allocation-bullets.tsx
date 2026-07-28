'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatINRCompact } from '@nidhi/core';
import { useLocale, useStrings } from '@/components/locale-provider';
import { localePath } from '@/lib/i18n';

/**
 * One row per ministry: the allocation as a track, the spending as a fill.
 *
 * This replaces a treemap, which was the wrong chart for this data twice over.
 * A treemap encodes one quantity as area, so it could show allocation or
 * spending but never the relationship between them, which is the only thing
 * this product is about. And with a long tail of forty-odd ministries, the
 * small tiles collapsed to a few pixels and their labels broke mid-word into
 * "Ministr y of Labou r".
 *
 * A bullet chart is the standard answer to measure-against-target, and it is
 * the simpler object: the row length is the allocation, the fill is what has
 * moved, and the tick is where a straight line through the year would have
 * reached. Every row is full width, so the smallest ministry is as legible as
 * the largest, and the label always has room.
 *
 * Drawn in the DOM rather than on a canvas. At this size the chart is a list of
 * divs, which makes every row hoverable, focusable, linkable and selectable as
 * text, and removes the whole class of canvas problems: no truncated labels, no
 * clipped marks, no separate table fallback needed because the markup already
 * is one.
 */

export interface BulletRow {
  id: string;
  name: string;
  /** Crore. */
  authority: number;
  /** Crore. Null when the source reports no spending figure. */
  spent: number | null;
  /** From burnColor() upstream. Never invented here. */
  color: string;
  authorityText: string;
  spentText: string;
  paceText: string;
}

interface AllocationBulletsProps {
  rows: BulletRow[];
  /** Share of the fiscal year elapsed, 0 to 1. Drawn as the target tick. */
  parFraction: number | null;
  parLabel: string;
  /** Rows shown before "show all". */
  limit?: number;
}

export function AllocationBullets({
  rows,
  parFraction,
  parLabel,
  limit = 12,
}: AllocationBulletsProps) {
  const strings = useStrings();
  const locale = useLocale();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  const ordered = useMemo(
    () => [...rows].sort((a, b) => b.authority - a.authority),
    [rows],
  );
  const shown = expanded ? ordered : ordered.slice(0, limit);
  // One scale across every row, so bar lengths are comparable between
  // ministries. Scaling each row to its own width would make a 300 crore
  // department look the same size as Defence.
  const max = Math.max(...ordered.map((row) => row.authority), 1);

  return (
    <div>
      <ol className="m-0 list-none p-0">
        {shown.map((row) => {
          const width = (row.authority / max) * 100;
          const fill = row.spent === null ? 0 : Math.min(row.spent / row.authority, 1) * 100;
          const overspent = row.spent !== null && row.spent > row.authority;
          return (
            <li key={row.id} className="border-b border-[color:var(--color-rule)] last:border-b-0">
              <button
                type="button"
                onClick={() => router.push(localePath(`/ministry/${row.id}`, locale))}
                className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-[var(--radius-sm)] px-1 py-2.5 text-left transition-colors hover:bg-[color:var(--color-surface-inset)]"
              >
                <span className="col-span-2 flex items-baseline justify-between gap-4">
                  <span className="truncate text-[13px] text-[color:var(--color-ink)]">
                    {row.name}
                  </span>
                  <span className="figure shrink-0 text-[12px] text-[color:var(--color-ink-soft)]">
                    {row.authorityText}
                  </span>
                </span>

                {/* A fixed right column, so every percentage sits on the same
                    vertical rule. Letting the label follow the end of a
                    variable-length bar puts it in a different place on every
                    row, and a ragged column of numbers cannot be scanned. */}
                <span className="col-span-2 grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-3">
                  {/* The full scale region. The bar inside it is the allocation
                      against the shared maximum, so lengths stay comparable. */}
                  <span className="relative block h-[9px] w-full">
                    <span
                      className="absolute inset-y-0 left-0 rounded-[3px]"
                      style={{
                        width: `${width}%`,
                        backgroundColor: 'var(--color-surface-sunk)',
                        boxShadow: 'inset 0 0 0 1px var(--color-rule)',
                      }}
                    >
                      {/* The fill is what has actually moved. */}
                      <span
                        className="absolute inset-y-0 left-0 rounded-[3px] transition-[width] duration-500 ease-out"
                        style={{ width: `${fill}%`, backgroundColor: row.color }}
                      />
                      {/* The tick is where a straight line through the year
                          would have reached by the date the spending figure
                          covers. Positioned within the bar, because it is a
                          share of that ministry's own allocation. */}
                      {parFraction !== null && parFraction > 0 ? (
                        <span
                          className="absolute top-[-3px] bottom-[-3px] w-px"
                          style={{
                            left: `${Math.min(parFraction, 1) * 100}%`,
                            backgroundColor: 'var(--color-ink-faint)',
                          }}
                          aria-hidden="true"
                        />
                      ) : null}
                    </span>
                  </span>
                  <span
                    className="figure text-right text-[11px] tabular-nums"
                    style={{ color: overspent ? 'var(--color-ahead)' : 'var(--color-ink-faint)' }}
                  >
                    {row.spent === null ? strings.common.notReported : row.paceText}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-[color:var(--color-ink-faint)]">
          {parFraction !== null ? parLabel : null}
        </p>
        {ordered.length > limit ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="text-[11px] text-[color:var(--color-ink-faint)] underline underline-offset-4 transition-colors hover:text-[color:var(--color-ink)]"
          >
            {expanded
              ? strings.analysis.showFewer
              : strings.analysis.showAll.replace('{count}', String(ordered.length))}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Axis-style caption for the shared scale, so the row lengths are readable. */
export function BulletScaleNote({ max }: { max: number }) {
  return (
    <span className="figure text-[11px] text-[color:var(--color-ink-faint)]">
      {formatINRCompact(max)}
    </span>
  );
}
