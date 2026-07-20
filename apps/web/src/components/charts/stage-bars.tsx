'use client';

import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { formatINRCr } from '@nidhi/core';
import { Chart, baseChartOption, chartTheme, axisLabelStyle } from '@/components/chart';
import { useStrings } from '@/components/locale-provider';

/**
 * The stage bars: allocated, released, utilised, on one axis with explicit
 * stage labels.
 *
 * The single rule this component exists to enforce is docs/06 P3: a stage the
 * source does not report must never be drawn as a zero-height bar. A missing
 * utilisation figure is the commonest case in Indian scheme data, and a flat bar
 * beside a full one would read as "this scheme spent nothing", which is a claim
 * no source has made. So an unreported stage is drawn instead as a dashed
 * full-width outline carrying the words "Not reported": impossible to mistake
 * for a quantity, and impossible to mistake for zero.
 *
 * Values arrive as `number | null` rather than as `Amount`, because NOT_REPORTED
 * is a symbol and symbols cannot cross the server to client boundary. The page
 * narrows them at the boundary; absence survives the trip as `null`.
 */

export interface StageDatum {
  key: string;
  /** Explicit stage label. Never abbreviated away. */
  label: string;
  value: number | null;
}

interface StageBarsProps {
  /** Stable id for the `chart_interacted` event. */
  chartId: string;
  stages: StageDatum[];
  ariaLabel: string;
}

/** A darkening ramp along the pipeline. Deliberately outside the pace axis:
 *  indigo and brass mean behind and ahead of the calendar, and a stage is not
 *  a pace, so borrowing those tones here would assert something untrue. */
const STAGE_COLORS = [chartTheme.onPace, chartTheme.inkSoft, chartTheme.ink] as const;

export function StageBars({ chartId, stages, ariaLabel }: StageBarsProps) {
  const strings = useStrings();
  const option = useMemo<EChartsOption>(() => {
    const reported = stages
      .map((stage) => stage.value)
      .filter((value): value is number => typeof value === 'number');
    const peak = reported.length > 0 ? Math.max(...reported) : 0;
    // A positive axis maximum is needed so the absence outline has a width to
    // span even when nothing at all is reported.
    const axisMax = peak > 0 ? peak * 1.02 : 1;

    return {
      ...baseChartOption,
      grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
      tooltip: { show: false },
      xAxis: {
        type: 'value',
        max: axisMax,
        show: false,
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: stages.map((stage) => stage.label),
        axisLine: { lineStyle: { color: chartTheme.ruleStrong } },
        axisTick: { show: false },
        axisLabel: { ...axisLabelStyle, fontFamily: 'var(--font-plex-sans), sans-serif' },
      },
      series: [
        {
          type: 'bar',
          name: strings.common.value,
          barWidth: 20,
          silent: false,
          data: stages.map((stage, index) => ({
            value: stage.value,
            itemStyle: { color: STAGE_COLORS[Math.min(index, STAGE_COLORS.length - 1)] },
          })),
          label: {
            show: true,
            position: 'right',
            distance: 8,
            fontFamily: 'var(--font-plex-mono), monospace',
            fontSize: 12,
            color: chartTheme.ink,
            formatter: (params: { value: unknown }) =>
              typeof params.value === 'number' ? formatINRCr(params.value, { decimals: 0 }) : '',
          },
        },
        {
          type: 'bar',
          name: strings.common.notReported,
          barWidth: 20,
          // Overlaid on the same category rather than stacked beside it.
          barGap: '-100%',
          silent: true,
          z: 1,
          data: stages.map((stage) =>
            stage.value === null
              ? {
                  value: axisMax,
                  itemStyle: {
                    color: 'transparent',
                    borderColor: chartTheme.unreported,
                    borderWidth: 1,
                    borderType: 'dashed' as const,
                  },
                  label: {
                    show: true,
                    position: 'insideLeft' as const,
                    distance: 8,
                    fontSize: 11,
                    color: chartTheme.unreported,
                    formatter: strings.common.notReported,
                  },
                }
              : { value: 0, itemStyle: { color: 'transparent' } },
          ),
        },
      ],
    };
  }, [stages, strings]);

  return (
    <Chart
      chartId={chartId}
      option={option}
      height={Math.max(140, stages.length * 56)}
      ariaLabel={ariaLabel}
      table={{
        columns: [strings.common.stage, strings.common.value],
        rows: stages.map((stage) => [
          stage.label,
          stage.value === null ? strings.common.notReported : formatINRCr(stage.value),
        ]),
      }}
    />
  );
}
