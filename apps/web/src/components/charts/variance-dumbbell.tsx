'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EChartsOption } from 'echarts';
import { Chart, axisLabelStyle, baseChartOption, chartTheme } from '@/components/chart';
import { useLocale, useStrings } from '@/components/locale-provider';
import { localePath } from '@/lib/i18n';

/**
 * Authority against spending, one row per ministry, joined by the gap.
 *
 * A dumbbell rather than paired bars. The quantity a reader is here for is the
 * distance between two values, and paired bars make that distance the one thing
 * on the chart you cannot measure: the eye compares two lengths from a shared
 * baseline instead of reading the space between them. Here the gap *is* the
 * mark, so it is read directly and sorts meaningfully.
 *
 * Rows are ordered by rupees behind the straight line rather than by percentage,
 * so the ministries at the top are the ones where the gap is the most public
 * money, not the ones that happen to be small.
 */

export interface VarianceRow {
  id: string;
  name: string;
  /** Crore. */
  authority: number;
  spent: number;
  varianceCr: number;
  paceRatio: number;
  /** From burnColor() upstream. Never invented in this component. */
  color: string;
  authorityText: string;
  spentText: string;
  varianceText: string;
  paceText: string;
}

interface VarianceDumbbellProps {
  rows: VarianceRow[];
  fy: string;
  /** Rows to draw. The rest stay one click away rather than in a 50-row wall. */
  limit?: number;
}

export function VarianceDumbbell({ rows, fy, limit = 15 }: VarianceDumbbellProps) {
  const strings = useStrings();
  const locale = useLocale();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  const shown = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.varianceCr - b.varianceCr);
    return expanded ? sorted : sorted.slice(0, limit);
  }, [rows, expanded, limit]);

  const byName = useMemo(() => new Map(shown.map((row) => [row.name, row])), [shown]);

  const option = useMemo<EChartsOption>(() => {
    // echarts draws the first category at the bottom of a value-y chart, so the
    // list is reversed to put the largest shortfall at the top where it reads.
    const ordered = [...shown].reverse();
    const names = ordered.map((row) => row.name);

    return {
      ...baseChartOption,
      grid: { left: 8, right: 24, top: 28, bottom: 8, containLabel: true },
      tooltip: {
        ...baseChartOption.tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(26,21,18,0.05)' } },
        formatter: (params: unknown) => {
          const list = params as Array<{ name: string }>;
          const row = byName.get(list?.[0]?.name ?? '');
          if (!row) return '';
          return [
            `<strong>${row.name}</strong>`,
            `${strings.stage.authority}: ${row.authorityText}`,
            `${strings.stage.spent}: ${row.spentText}`,
            `${strings.analysis.tooltipVariance}: ${row.varianceText}`,
            `${strings.pace.label}: ${row.paceText}`,
          ].join('<br/>');
        },
      },
      xAxis: {
        type: 'value',
        axisLabel: { ...axisLabelStyle, formatter: (v: number) => `${Math.round(v / 1000)}k` },
        splitLine: { lineStyle: { color: chartTheme.rule, type: 'dashed' } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'category',
        data: names,
        axisLabel: {
          ...axisLabelStyle,
          fontFamily: 'var(--font-plex-sans), system-ui, sans-serif',
          width: 190,
          overflow: 'truncate',
          color: chartTheme.inkSoft,
        },
        axisLine: { lineStyle: { color: chartTheme.rule } },
        axisTick: { show: false },
      },
      series: [
        {
          // The gap, drawn as the mark it is. A floating bar from spent to
          // authority: its length is the unspent balance, read directly.
          type: 'bar',
          stack: 'gap',
          silent: true,
          itemStyle: { color: 'transparent' },
          data: ordered.map((row) => Math.min(row.spent, row.authority)),
          barWidth: 3,
        },
        {
          type: 'bar',
          stack: 'gap',
          name: strings.analysis.gapSeries,
          itemStyle: { color: chartTheme.rule },
          data: ordered.map((row) => Math.abs(row.authority - row.spent)),
          barWidth: 3,
        },
        {
          // Authority: the hollow end. An outline reads as a target rather than
          // as a quantity already spent.
          type: 'scatter',
          name: strings.stage.authority,
          symbolSize: 11,
          z: 3,
          itemStyle: {
            color: chartTheme.paperRaised,
            borderColor: chartTheme.ink,
            borderWidth: 1.5,
          },
          data: ordered.map((row) => [row.authority, row.name]),
        },
        {
          // Spending: the filled end, in the pace colour, so position on the
          // row and colour say the same thing twice.
          type: 'scatter',
          name: strings.stage.spent,
          symbolSize: 11,
          z: 4,
          itemStyle: {
            color: (params: { dataIndex: number }) =>
              ordered[params.dataIndex]?.color ?? chartTheme.onPace,
            borderColor: chartTheme.paperRaised,
            borderWidth: 1.5,
          },
          data: ordered.map((row) => [row.spent, row.name]),
        },
      ],
      legend: {
        top: 0,
        left: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: chartTheme.inkFaint, fontSize: 11 },
        data: [strings.stage.authority, strings.stage.spent, strings.analysis.gapSeries],
      },
    };
  }, [shown, byName, strings]);

  return (
    <div>
      <Chart
        chartId="variance_dumbbell"
        option={option}
        height={Math.max(260, shown.length * 26 + 60)}
        ariaLabel={strings.analysis.dumbbellAria}
        table={{
          columns: [
            strings.analysis.colMinistry,
            strings.stage.authority,
            strings.stage.spent,
            strings.analysis.tooltipVariance,
            strings.pace.label,
          ],
          rows: shown.map((row) => [
            row.name,
            row.authorityText,
            row.spentText,
            row.varianceText,
            row.paceText,
          ]),
        }}
        onSelect={(name) => {
          const row = byName.get(name);
          if (row) router.push(localePath(`/ministry/${row.id}`, locale));
        }}
      />
      {rows.length > limit ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 cursor-pointer text-[11px] uppercase tracking-wider text-[color:var(--color-ink-faint)] underline underline-offset-4 transition-colors hover:text-[color:var(--color-ink)]"
        >
          {expanded
            ? strings.analysis.showFewer
            : strings.analysis.showAll.replace('{count}', String(rows.length))}
        </button>
      ) : null}
      <p className="mt-2 text-[11px] text-[color:var(--color-ink-faint)]">
        {strings.analysis.dumbbellNote.replace('{fy}', fy)}
      </p>
    </div>
  );
}
