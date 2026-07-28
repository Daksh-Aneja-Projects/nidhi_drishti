'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useStrings } from '@/components/locale-provider';
import { localePath } from '@/lib/i18n';

/**
 * Shortfall against a straight line, ranked, with the cumulative share.
 *
 * This replaces a dumbbell, which had the same defect as the treemap before it:
 * it drew the two endpoints at a shared scale, so a department 200 times
 * smaller than Defence collapsed into a single speck and forty of the rows
 * carried no readable information at all.
 *
 * The quantity worth ranking is the signed gap in rupees, so it is drawn as a
 * diverging bar from a zero rule: left is behind the line, right is ahead,
 * length is how much public money the gap is. That is one encoding for one
 * question, and it sorts.
 *
 * The cumulative column is what makes it a variance analysis rather than a
 * league table. Reading down it answers the question a ranked list always
 * provokes and rarely answers: how much of the total shortfall is actually in
 * these top few? When four ministries carry sixty percent of it, that is the
 * finding, and it is invisible on any chart that shows magnitudes alone.
 *
 * Drawn in the DOM. Every row is a real link, the labels never truncate
 * mid-word, and the markup is already the table fallback.
 */

export interface VarianceBarRow {
  id: string;
  name: string;
  /** Crore. Negative is behind the straight line. */
  varianceCr: number;
  color: string;
  authorityText: string;
  spentText: string;
  varianceText: string;
  paceText: string;
}

interface VarianceBarsProps {
  rows: VarianceBarRow[];
  limit?: number;
}

export function VarianceBars({ rows, limit = 14 }: VarianceBarsProps) {
  const strings = useStrings();
  const locale = useLocale();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  const { ordered, scale, totalBehind } = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.varianceCr - b.varianceCr);
    return {
      ordered: sorted,
      // One scale for both directions, so a bar's length means the same thing
      // whichever way it points.
      scale: Math.max(...sorted.map((row) => Math.abs(row.varianceCr)), 1),
      totalBehind: sorted
        .filter((row) => row.varianceCr < 0)
        .reduce((sum, row) => sum + Math.abs(row.varianceCr), 0),
    };
  }, [rows]);

  const shown = expanded ? ordered : ordered.slice(0, limit);

  let running = 0;
  return (
    <div>
      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_5.5rem_4rem] items-center gap-x-3 border-b border-[color:var(--color-rule)] pb-1.5">
        <span className="eyebrow">{strings.analysis.colMinistry}</span>
        <span className="eyebrow text-center">{strings.analysis.colVariance}</span>
        <span className="eyebrow text-right">{strings.analysis.colSpent}</span>
        <span className="eyebrow text-right">{strings.analysis.cumulative}</span>
      </div>

      <ol className="m-0 list-none p-0">
        {shown.map((row) => {
          const behind = row.varianceCr < 0;
          if (behind) running += Math.abs(row.varianceCr);
          const share = totalBehind > 0 ? (running / totalBehind) * 100 : 0;
          const magnitude = (Math.abs(row.varianceCr) / scale) * 50;
          return (
            <li key={row.id} className="border-b border-[color:var(--color-rule)] last:border-b-0">
              <button
                type="button"
                onClick={() => router.push(localePath(`/ministry/${row.id}`, locale))}
                className="grid w-full grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_5.5rem_4rem] items-center gap-x-3 rounded-[var(--radius-sm)] py-2 text-left transition-colors hover:bg-[color:var(--color-surface-inset)]"
              >
                <span className="truncate text-[13px] text-[color:var(--color-ink)]">
                  {row.name}
                </span>

                {/* The diverging bar. Zero is the centre rule; behind runs left. */}
                <span className="relative block h-[14px] w-full">
                  <span
                    className="absolute inset-y-[-3px] left-1/2 w-px"
                    style={{ backgroundColor: 'var(--color-rule-strong)' }}
                    aria-hidden="true"
                  />
                  <span
                    className="absolute inset-y-0 rounded-[3px] transition-[width] duration-500 ease-out"
                    style={{
                      backgroundColor: row.color,
                      width: `${magnitude}%`,
                      left: behind ? `${50 - magnitude}%` : '50%',
                    }}
                  />
                </span>

                <span
                  className="figure text-right text-[12px] tabular-nums"
                  style={{ color: behind ? 'var(--color-behind)' : 'var(--color-ahead)' }}
                >
                  {row.varianceText}
                </span>

                {/* Cumulative share of the total shortfall, reading down. */}
                <span className="figure text-right text-[11px] tabular-nums text-[color:var(--color-ink-faint)]">
                  {behind ? `${share.toFixed(0)}%` : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {ordered.length > limit ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-3 text-[11px] text-[color:var(--color-ink-faint)] underline underline-offset-4 transition-colors hover:text-[color:var(--color-ink)]"
        >
          {expanded
            ? strings.analysis.showFewer
            : strings.analysis.showAll.replace('{count}', String(ordered.length))}
        </button>
      ) : null}
    </div>
  );
}
