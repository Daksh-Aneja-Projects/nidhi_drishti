'use client';

import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { formatINRCompact, formatINRCr } from '@nidhi/core';
import { Chart, axisLabelStyle, baseChartOption, chartTheme } from '@/components/chart';
import { strings } from '@/lib/strings';

/**
 * De-cumulated monthly expenditure.
 *
 * Two conventions carry meaning here and are not styling choices. Provisional
 * months are hatched, the same vocabulary the pace track uses for the part of a
 * figure that has not settled. The prior year sits behind as a ghost bar rather
 * than beside it, so the comparison reads as one column per month.
 *
 * A month with no reported figure is a gap in the series, never a zero bar.
 */

export interface MonthlyBar {
  label: string;
  /** Crore, or null when the source does not report the month. */
  monthly: number | null;
  isProvisional: boolean;
}

interface MonthlySpendChartProps {
  chartId: string;
  points: MonthlyBar[];
  /** Same months a year earlier, aligned by fiscal month index. */
  priorPoints?: Array<{ label: string; monthly: number | null }>;
  height?: number;
  ariaLabel: string;
}

/** Hatching means uncertainty systemwide. Provisional months get it too. */
function provisionalDecal() {
  return {
    symbol: 'rect',
    dashArrayX: [1, 0],
    dashArrayY: [2, 4],
    rotation: -Math.PI / 4,
    color: 'rgba(239, 241, 238, 0.85)',
  };
}

function amountText(value: number | null): string {
  return value === null ? strings.common.notReported : formatINRCr(value);
}

export function MonthlySpendChart({
  chartId,
  points,
  priorPoints,
  height = 300,
  ariaLabel,
}: MonthlySpendChartProps) {
  const hasPrior = Boolean(priorPoints && priorPoints.some((point) => point.monthly !== null));

  const option = useMemo<EChartsOption>(() => {
    const categories = points.map((point) => point.label);

    const ghostSeries = hasPrior
      ? [
          {
            type: 'bar' as const,
            name: strings.common.previousYear,
            barWidth: '64%',
            z: 1,
            itemStyle: { color: chartTheme.paperSunk, borderColor: chartTheme.rule, borderWidth: 1 },
            data: points.map((_, index) => priorPoints?.[index]?.monthly ?? null),
          },
        ]
      : [];

    return {
      ...baseChartOption,
      grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
      legend: hasPrior
        ? {
            bottom: 0,
            icon: 'rect',
            itemWidth: 10,
            itemHeight: 10,
            textStyle: { color: chartTheme.inkFaint, fontSize: 11 },
            data: [strings.common.previousYear, strings.common.thisYear],
          }
        : undefined,
      tooltip: {
        ...baseChartOption.tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
      },
      xAxis: {
        type: 'category',
        data: categories,
        axisLine: { lineStyle: { color: chartTheme.ruleStrong } },
        axisTick: { show: false },
        axisLabel: { ...axisLabelStyle, interval: 0, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: chartTheme.rule, type: 'dashed' } },
        axisLabel: {
          ...axisLabelStyle,
          formatter: (value: number) => formatINRCompact(value),
        },
      },
      series: [
        ...ghostSeries,
        {
          type: 'bar',
          name: strings.common.thisYear,
          barWidth: hasPrior ? '38%' : '58%',
          barGap: hasPrior ? '-100%' : undefined,
          z: 2,
          data: points.map((point) => ({
            value: point.monthly,
            itemStyle: point.isProvisional
              ? { color: chartTheme.behind as string, decal: provisionalDecal() }
              : { color: chartTheme.behind as string },
          })),
        },
      ],
    };
  }, [points, priorPoints, hasPrior]);

  const table = useMemo(() => {
    const columns = hasPrior
      ? [strings.common.month, strings.common.thisYear, strings.common.previousYear, strings.common.stage]
      : [strings.common.month, strings.common.thisYear, strings.common.stage];
    return {
      columns,
      rows: points.map((point, index) => {
        const stage = point.isProvisional ? strings.common.provisional : strings.common.total;
        return hasPrior
          ? [
              point.label,
              amountText(point.monthly),
              amountText(priorPoints?.[index]?.monthly ?? null),
              stage,
            ]
          : [point.label, amountText(point.monthly), stage];
      }),
    };
  }, [points, priorPoints, hasPrior]);

  return (
    <Chart
      chartId={chartId}
      option={option}
      height={height}
      ariaLabel={ariaLabel}
      table={table}
    />
  );
}
