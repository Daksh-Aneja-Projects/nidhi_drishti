'use client';

import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { FISCAL_STAGE_LABELS, formatINRCompact, formatINRCr } from '@nidhi/core';
import { Chart, axisLabelStyle, baseChartOption, chartTheme } from '@/components/chart';
import { strings } from '@/lib/strings';

/**
 * Allocation across five financial years.
 *
 * Three stages side by side rather than one blended "budget" line, so a year
 * where the revised estimate moved sharply away from the budget estimate reads
 * as two different numbers, which is what it is.
 */

export interface YoyRow {
  fy: string;
  be: number | null;
  re: number | null;
  expenditure: number | null;
}

interface YoyAllocationChartProps {
  chartId: string;
  rows: YoyRow[];
  height?: number;
  ariaLabel: string;
}

function amountText(value: number | null): string {
  return value === null ? strings.common.notReported : formatINRCr(value);
}

export function YoyAllocationChart({
  chartId,
  rows,
  height = 300,
  ariaLabel,
}: YoyAllocationChartProps) {
  const option = useMemo<EChartsOption>(() => {
    const series = [
      { name: FISCAL_STAGE_LABELS.BE, color: chartTheme.behindSoft, pick: (row: YoyRow) => row.be },
      { name: FISCAL_STAGE_LABELS.RE, color: chartTheme.behind, pick: (row: YoyRow) => row.re },
      {
        name: FISCAL_STAGE_LABELS.EXPENDITURE,
        color: chartTheme.ahead,
        pick: (row: YoyRow) => row.expenditure,
      },
    ];

    return {
      ...baseChartOption,
      grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
      legend: {
        bottom: 0,
        icon: 'rect',
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: chartTheme.inkFaint, fontSize: 11 },
      },
      tooltip: { ...baseChartOption.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: {
        type: 'category',
        data: rows.map((row) => row.fy),
        axisLine: { lineStyle: { color: chartTheme.ruleStrong } },
        axisTick: { show: false },
        axisLabel: { ...axisLabelStyle, interval: 0 },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: chartTheme.rule, type: 'dashed' } },
        axisLabel: { ...axisLabelStyle, formatter: (value: number) => formatINRCompact(value) },
      },
      series: series.map((definition) => ({
        type: 'bar' as const,
        name: definition.name,
        barMaxWidth: 28,
        itemStyle: { color: definition.color },
        data: rows.map((row) => definition.pick(row)),
      })),
    };
  }, [rows]);

  const table = useMemo(
    () => ({
      columns: [
        strings.common.fiscalYear,
        FISCAL_STAGE_LABELS.BE,
        FISCAL_STAGE_LABELS.RE,
        FISCAL_STAGE_LABELS.EXPENDITURE,
      ],
      rows: rows.map((row) => [
        row.fy,
        amountText(row.be),
        amountText(row.re),
        amountText(row.expenditure),
      ]),
    }),
    [rows],
  );

  return (
    <Chart chartId={chartId} option={option} height={height} ariaLabel={ariaLabel} table={table} />
  );
}
