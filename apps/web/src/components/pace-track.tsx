import {
  burnBand,
  burnColor,
  burnDescription,
  formatPercent,
  isNotReported,
  type Amount,
  type BurnMetrics,
} from '@nidhi/core';
import { getStrings } from '@/lib/i18n-server';

/**
 * The pace track: the product's signature element.
 *
 * Two positions on one axis. Where the calendar had reached, and how much of
 * the allocation had been spent by that date. The distance between them is the
 * whole story, so it is drawn as a hatched region rather than left implicit.
 *
 * The same component renders at three sizes so the motif carries all the way
 * from the national hero down to a chip inside a table row. A reader learns to
 * read it once.
 *
 * Hatching means uncertainty everywhere in this product; here it marks the gap
 * that has yet to be spent or has already been overspent, which is exactly the
 * quantity nobody should read as settled.
 */

export type PaceTrackSize = 'hero' | 'default' | 'chip';

interface PaceTrackProps {
  burn: BurnMetrics;
  size?: PaceTrackSize;
  /** Hide the numeric readout when the surrounding layout already states it. */
  showReadout?: boolean;
  /** Suppress the load animation for tracks rendered far down a long list. */
  animate?: boolean;
  label?: string;
}

const SIZES: Record<PaceTrackSize, { height: number; markerHeight: number; className: string }> = {
  hero: { height: 44, markerHeight: 60, className: 'w-full' },
  default: { height: 20, markerHeight: 30, className: 'w-full' },
  chip: { height: 10, markerHeight: 16, className: 'w-20' },
};

/** Clamp to the drawable range. Beyond 150% of the year the track stops growing. */
function toTrackPosition(percent: number): number {
  return Math.max(0, Math.min(100, percent));
}

export async function PaceTrack({
  burn,
  size = 'default',
  showReadout = true,
  animate = true,
  label,
}: PaceTrackProps) {
  const strings = await getStrings();
  const { height, markerHeight, className } = SIZES[size];
  const isChip = size === 'chip';

  // Without an expenditure figure there is no second marker, so the track would
  // be asserting a position it does not have. Say so instead of drawing it.
  if (isNotReported(burn.pctSpent) || burn.pctFyElapsed === 0) {
    return (
      <div className={className} role="img" aria-label={strings.pace.unavailable}>
        <div
          className="hatch w-full text-[color:var(--color-unreported)]"
          style={{ height, backgroundColor: 'var(--color-paper-sunk)' }}
        />
        {showReadout && !isChip ? (
          <p className="mt-1.5 text-xs text-[color:var(--color-ink-faint)]">
            {strings.pace.unavailable}
          </p>
        ) : null}
      </div>
    );
  }

  const spentPos = toTrackPosition(burn.pctSpent);
  const calendarPos = toTrackPosition(burn.pctFyElapsed);
  const gapStart = Math.min(spentPos, calendarPos);
  const gapWidth = Math.abs(calendarPos - spentPos);
  const isBehind = spentPos < calendarPos;
  const band = burnBand(burn.burnRatio);
  const accent = burnColor(burn.burnRatio);

  const gapLabel = isBehind ? strings.pace.lag : strings.pace.lead;
  const description = `${formatPercent(burn.pctSpent, { decimals: 1 })} ${strings.pace.spendMarker.toLowerCase()}, ${formatPercent(burn.pctFyElapsed, { decimals: 1 })} ${strings.pace.calendarMarker.toLowerCase()}. ${burnDescription(burn.burnRatio)}`;

  return (
    <div className={className}>
      <div
        className="relative"
        style={{ height: markerHeight }}
        role="img"
        aria-label={`${label ? `${label}. ` : ''}${description}`}
      >
        {/* The track itself. A ruled channel, not a floating bar: the inset
            edge is what makes it read as an instrument with a zero and a full,
            which matters most when the fill colour is the neutral of on-pace
            and would otherwise be a grey rectangle on a grey field. */}
        <div
          className="absolute left-0 right-0 top-1/2 -translate-y-1/2 overflow-hidden"
          style={{
            height,
            backgroundColor: 'var(--color-paper-sunk)',
            boxShadow: 'inset 0 0 0 1px var(--color-rule)',
          }}
        >
          {/* Spend fill, with a defined leading edge so the reading is exact. */}
          <div
            className={`absolute inset-y-0 left-0 ${animate ? 'animate-track' : ''}`}
            style={{
              width: `${spentPos}%`,
              backgroundColor: accent,
              boxShadow: 'inset -1px 0 0 0 rgba(22,32,43,0.35)',
            }}
          />
          {/* The gap: hatched, because it is the part that has not settled. */}
          {gapWidth > 0.5 ? (
            <div
              className="hatch absolute inset-y-0"
              style={{
                left: `${gapStart}%`,
                width: `${gapWidth}%`,
                color: isBehind ? 'var(--color-behind)' : 'var(--color-ahead)',
              }}
            />
          ) : null}

          {/* Quarter ticks. The fiscal year is the axis this whole product
              measures against, so its divisions are drawn rather than left to
              the reader to estimate from a bare bar. */}
          {!isChip
            ? [25, 50, 75].map((tick) => (
                <div
                  key={tick}
                  className="absolute top-0 bottom-0 w-px opacity-40"
                  style={{ left: `${tick}%`, backgroundColor: 'var(--color-rule-strong)' }}
                  aria-hidden="true"
                />
              ))
            : null}
        </div>

        {/* Calendar marker: a full-height rule, the way a date line is drawn on
            a register rather than a floating dot. */}
        <div
          className={`absolute top-0 bottom-0 ${animate ? 'animate-marker' : ''}`}
          style={{ left: `${calendarPos}%` }}
        >
          <div
            className="h-full w-px"
            style={{ backgroundColor: 'var(--color-ink)' }}
            aria-hidden="true"
          />
          {/* Named at the rule, because an unlabelled line on a chart is a
              thing the reader has to go and look up. */}
          {size === 'hero' ? (
            <span
              className="absolute top-0 whitespace-nowrap text-[10px] font-medium uppercase tracking-wider text-[color:var(--color-ink)]"
              style={{
                left: calendarPos > 70 ? 'auto' : '4px',
                right: calendarPos > 70 ? '4px' : 'auto',
              }}
              aria-hidden="true"
            >
              {strings.pace.calendarMarker}
            </span>
          ) : null}
        </div>
      </div>

      {/* The scale. Only on the hero, where there is room for it to be read. */}
      {size === 'hero' ? (
        <div
          className="relative mt-1 h-3 text-[10px] text-[color:var(--color-ink-faint)]"
          aria-hidden="true"
        >
          {[0, 25, 50, 75, 100].map((tick) => (
            <span
              key={tick}
              className="figure absolute -translate-x-1/2"
              style={{ left: `${tick}%` }}
            >
              {tick === 100 ? '100%' : tick}
            </span>
          ))}
        </div>
      ) : null}

      {showReadout && !isChip ? (
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-xs text-[color:var(--color-ink-soft)]">
            <span className="figure font-medium" style={{ color: accent }}>
              {formatPercent(burn.pctSpent, { decimals: 1 })}
            </span>{' '}
            {strings.pace.spendMarker.toLowerCase()}
            <span className="mx-1.5 text-[color:var(--color-rule-strong)]">/</span>
            <span className="figure font-medium">
              {formatPercent(burn.pctFyElapsed, { decimals: 1 })}
            </span>{' '}
            {strings.pace.calendarMarker.toLowerCase()}
          </span>
          <span className="eyebrow" style={{ color: accent }}>
            {band === 'on_pace' ? strings.pace.onPace : gapLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Table-row variant. Carries its own accessible description because a chip has
 * no room for the readout that normally supplies it.
 */
export function PaceChip({ burn, label }: { burn: BurnMetrics; label?: string }) {
  return <PaceTrack burn={burn} size="chip" showReadout={false} animate={false} label={label} />;
}

/** Legend for the pace axis, shown once per page that colours by pace. */
export async function PaceLegend({ className = '' }: { className?: string }) {
  const strings = await getStrings();
  const stops: Array<{ ratio: Amount; label: string }> = [
    { ratio: 0.3, label: strings.pace.legendFarBehind },
    { ratio: 0.7, label: strings.pace.legendBehind },
    { ratio: 1.0, label: strings.pace.legendInStep },
    { ratio: 1.25, label: strings.pace.legendAhead },
    { ratio: 1.7, label: strings.pace.legendFarAhead },
  ];
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${className}`}>
      {stops.map((stop) => (
        <span key={stop.label} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-6"
            style={{ backgroundColor: burnColor(stop.ratio) }}
            aria-hidden="true"
          />
          <span className="text-xs text-[color:var(--color-ink-faint)]">{stop.label}</span>
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span
          className="hatch inline-block h-2.5 w-6 text-[color:var(--color-unreported)]"
          style={{ backgroundColor: 'var(--color-paper-sunk)' }}
          aria-hidden="true"
        />
        <span className="text-xs text-[color:var(--color-ink-faint)]">
          {strings.common.notReported}
        </span>
      </span>
    </div>
  );
}
