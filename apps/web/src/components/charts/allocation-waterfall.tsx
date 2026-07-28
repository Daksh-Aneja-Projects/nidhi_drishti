'use client';

import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { formatINRCompact, formatINRCr } from '@nidhi/core';
import { Chart, axisLabelStyle, baseChartOption, chartTheme } from '@/components/chart';
import { useStrings } from '@/components/locale-provider';

/**
 * Budget estimate to balance, one step per stage.
 *
 * The stages are never merged: an authority step and an expenditure step sit on
 * the same axis but are drawn in different tones, because conflating permission
 * to spend with money accounted as spent is the mistake this whole product
 * exists to prevent.
 *
 * A step whose figure is unreported is left blank rather than bridged. The
 * running total after it is unknown, and the chart says so instead of guessing.
 */

export interface WaterfallStep {
  label: string;
  /** Crore. For `delta` steps this is signed. Null when unreported. */
  value: number | null;
  kind: 'total' | 'delta';
}

interface AllocationWaterfallProps {
  chartId: string;
  steps: WaterfallStep[];
  height?: number;
  ariaLabel: string;
}

interface Column {
  label: string;
  base: number | null;
  span: number | null;
  color: string;
  valueText: string;
}

function buildColumns(steps: WaterfallStep[], notReportedLabel: string): Column[] {
  let running: number | null = 0;
  return steps.map((step) => {
    const valueText =
      step.value === null
        ? notReportedLabel
        : formatINRCr(step.value, { signed: step.kind === 'delta' });

    if (step.value === null) {
      running = null;
      return { label: step.label, base: null, span: null, color: chartTheme.unreported, valueText };
    }

    if (step.kind === 'total') {
      running = step.value;
      return {
        label: step.label,
        base: 0,
        span: step.value,
        color: chartTheme.behind,
        valueText,
      };
    }

    if (running === null) {
      return { label: step.label, base: null, span: null, color: chartTheme.unreported, valueText };
    }

    const next = running + step.value;
    const base = Math.min(running, next);
    const span = Math.abs(step.value);
    const color = step.value >= 0 ? chartTheme.aheadSoft : chartTheme.behindSoft;
    running = next;
    return { label: step.label, base, span, color, valueText };
  });
}

export function AllocationWaterfall({
  chartId,
  steps,
  height = 320,
  ariaLabel,
}: AllocationWaterfallProps) {
  const strings = useStrings();
  const columns = useMemo(() => buildColumns(steps, strings.common.notReported), [steps, strings]);

  const option = useMemo<EChartsOption>(() => {
    return {
      ...baseChartOption,
      grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
      tooltip: {
        ...baseChartOption.tooltip,
        trigger: 'item',
        formatter: (params: unknown) => {
          const index = (params as { dataIndex?: number }).dataIndex ?? 0;
          const column = columns[index];
          if (!column) return '';
          return `${column.label}<br/>${column.valueText}`;
        },
      },
      xAxis: {
        type: 'category',
        data: columns.map((column) => column.label),
        axisLine: { lineStyle: { color: chartTheme.ruleStrong } },
        axisTick: { show: false },
        axisLabel: { ...axisLabelStyle, interval: 0, hideOverlap: true, width: 90, overflow: 'break' },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: chartTheme.rule, type: 'dashed' } },
        axisLabel: { ...axisLabelStyle, formatter: (value: number) => formatINRCompact(value) },
      },
      series: [
        {
          type: 'bar',
          stack: 'waterfall',
          silent: true,
          itemStyle: { color: 'transparent' },
          emphasis: { disabled: true },
          data: columns.map((column) => column.base),
        },
        {
          type: 'bar',
          stack: 'waterfall',
          barWidth: '52%',
          data: columns.map((column) => ({
            value: column.span,
            itemStyle: { color: column.color },
          })),
          // The value on each step. A waterfall is read as arithmetic, and
          // arithmetic without its numbers asks the reader to measure bar
          // heights against a gridline to check that the steps add up.
          label: {
            show: true,
            position: 'top',
            formatter: (params: { dataIndex: number }) =>
              columns[params.dataIndex]?.valueText ?? '',
            color: chartTheme.inkSoft,
            fontSize: 10,
            fontFamily: 'var(--font-plex-mono), monospace',
          },
        },
        {
          // Connectors: the ledger rule carried across from the top of one step
          // to the foot of the next, which is what makes a row of bars read as
          // one running total rather than as five separate quantities.
          type: 'custom',
          silent: true,
          renderItem: (params: unknown, api: unknown) => {
            const a = api as {
              value: (i: number) => number;
              coord: (p: number[]) => number[];
            };
            const index = (params as { dataIndex: number }).dataIndex;
            const next = columns[index + 1];
            const current = columns[index];
            // A step the source did not report has no settled top to carry
            // from, so the line stops rather than spanning the gap and
            // implying continuity across a figure nobody published.
            if (!next || !current || current.base === null || current.span === null) return null;
            // Carry from the settled top of this step to the same height at the
            // start of the next one.
            const carry = current.base + current.span;
            const [x1, y] = a.coord([index, carry]);
            const [x2] = a.coord([index + 1, carry]);
            return {
              type: 'line',
              shape: { x1: x1! + 4, y1: y!, x2: x2! - 4, y2: y! },
              style: { stroke: chartTheme.ruleStrong, lineWidth: 1, lineDash: [3, 3] },
            };
          },
          data: columns.map((_, index) => [index, 0]),
        },
      ],
    };
  }, [columns]);

  const table = useMemo(
    () => ({
      columns: [strings.common.stage, strings.common.value],
      rows: columns.map((column) => [column.label, column.valueText]),
    }),
    [columns],
  );

  return (
    <Chart chartId={chartId} option={option} height={height} ariaLabel={ariaLabel} table={table} />
  );
}
