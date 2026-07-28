'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { EChartsOption } from 'echarts';
import { Chart, axisLabelStyle, baseChartOption, chartTheme } from '@/components/chart';
import { useLocale, useStrings } from '@/components/locale-provider';
import { localePath } from '@/lib/i18n';

/**
 * Every ministry as one mark on the pace axis, sized by its authority.
 *
 * A league table answers "who is worst" and hides the shape of the thing. This
 * answers the question a table cannot: is the government broadly on the line
 * with two outliers, or is most of it behind? Those are different stories and
 * they lead to different questions, and only the distribution distinguishes
 * them.
 *
 * Marks are dodged vertically where they would otherwise overlap, so a cluster
 * shows its own density instead of collapsing into one dot. Area is authority,
 * so the eye weights a large ministry more than a small one, which is the
 * correct weighting for a chart about public money.
 */

export interface PacePoint {
  id: string;
  name: string;
  /** absorption / par. 1.0 is exactly on the line. */
  paceRatio: number;
  /** Crore, drives the mark area. */
  authority: number;
  color: string;
  authorityText: string;
  spentText: string;
  paceText: string;
}

interface PaceDistributionProps {
  points: PacePoint[];
  /** Share of the year elapsed, for the reference line label. */
  parLabel: string;
}

/** Drawn mark diameters, in pixels. The axis padding is derived from the max. */
const MIN_SYMBOL_PX = 9;
const MAX_SYMBOL_PX = 38;
/** Approximate pixels per row unit at the chart height this component renders. */
const ROW_PX = 26;

/** Lay marks out so a crowded band shows its density rather than one dot. */
function dodge(points: PacePoint[]): Array<PacePoint & { row: number }> {
  const placed: Array<PacePoint & { row: number }> = [];
  // Largest first: a big ministry keeps the centre line and small ones move.
  const ordered = [...points].sort((a, b) => b.authority - a.authority);
  for (const point of ordered) {
    let row = 0;
    // Walk outward from the centre until a row is free at this x.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const candidate = attempt === 0 ? 0 : Math.ceil(attempt / 2) * (attempt % 2 === 0 ? 1 : -1);
      const collides = placed.some(
        (other) => other.row === candidate && Math.abs(other.paceRatio - point.paceRatio) < 0.055,
      );
      if (!collides) {
        row = candidate;
        break;
      }
      row = candidate;
    }
    placed.push({ ...point, row });
  }
  return placed;
}

export function PaceDistribution({ points, parLabel }: PaceDistributionProps) {
  const strings = useStrings();
  const locale = useLocale();
  const router = useRouter();

  const laid = useMemo(() => dodge(points), [points]);
  const byId = useMemo(() => new Map(laid.map((point) => [point.id, point])), [laid]);

  const option = useMemo<EChartsOption>(() => {
    const maxAuthority = Math.max(...laid.map((point) => point.authority), 1);
    const rows = Math.max(...laid.map((point) => Math.abs(point.row)), 2);
    // Marks are placed by row index but drawn in pixels, so the axis has to
    // reserve room for the radius of the largest one or the biggest ministry
    // is the one that gets clipped by the plot edge.
    const rowsWithPadding = rows + MAX_SYMBOL_PX / 2 / ROW_PX;

    return {
      ...baseChartOption,
      // Top leaves room for the straight-line label, which sits above the plot.
      grid: { left: 8, right: 16, top: 30, bottom: 34, containLabel: true },
      tooltip: {
        ...baseChartOption.tooltip,
        formatter: (params: unknown) => {
          const point = (params as { data: { id: string } }).data;
          const row = byId.get(point.id);
          if (!row) return '';
          return [
            `<strong>${row.name}</strong>`,
            `${strings.stage.authority}: ${row.authorityText}`,
            `${strings.stage.spent}: ${row.spentText}`,
            `${strings.pace.label}: ${row.paceText}`,
          ].join('<br/>');
        },
      },
      xAxis: {
        type: 'value',
        min: 0,
        max: Math.max(1.6, ...laid.map((point) => point.paceRatio + 0.1)),
        name: strings.analysis.paceAxis,
        nameLocation: 'middle',
        nameGap: 26,
        nameTextStyle: { color: chartTheme.inkFaint, fontSize: 11 },
        axisLabel: {
          ...axisLabelStyle,
          formatter: (value: number) => `${Math.round(value * 100)}%`,
        },
        splitLine: { show: false },
        axisLine: { lineStyle: { color: chartTheme.rule } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        min: -rowsWithPadding,
        max: rowsWithPadding,
        show: false,
      },
      series: [
        {
          type: 'scatter',
          // Area, not diameter: doubling the radius would quadruple the
          // apparent quantity and overstate every large ministry.
          symbolSize: (value: unknown) => {
            const authority = (value as number[])[2] ?? 0;
            return MIN_SYMBOL_PX + (MAX_SYMBOL_PX - MIN_SYMBOL_PX) * Math.sqrt(authority / maxAuthority);
          },
          itemStyle: {
            color: (params: { data: { color: string } }) => params.data.color,
            borderColor: chartTheme.paperRaised,
            borderWidth: 1.5,
            opacity: 0.95,
          },
          emphasis: {
            itemStyle: { borderColor: chartTheme.ink, borderWidth: 2 },
            scale: 1.08,
          },
          data: laid.map((point) => ({
            value: [point.paceRatio, point.row, point.authority],
            id: point.id,
            color: point.color,
          })),
          markLine: {
            silent: true,
            symbol: 'none',
            // The straight line. Everything on this chart is a distance from it,
            // so it is drawn rather than left for the reader to infer from an
            // axis tick.
            lineStyle: { color: chartTheme.ink, width: 1.5, type: 'solid' },
            label: {
              formatter: parLabel,
              color: chartTheme.ink,
              fontSize: 10,
              // Above the plot and nudged off the rule, so it never sits under
              // a mark and never gets clipped by the top of the canvas.
              position: 'start',
              distance: 8,
              fontFamily: 'var(--font-plex-sans), system-ui, sans-serif',
            },
            data: [{ xAxis: 1 }],
          },
        },
      ],
      // echarts types model markLine label position as a narrower union than
      // the runtime accepts, and the scatter symbolSize callback is typed for
      // the simple case. The option is exercised by the rendered chart.
    } as EChartsOption;
  }, [laid, byId, strings, parLabel]);

  return (
    <Chart
      chartId="pace_distribution"
      option={option}
      height={300}
      ariaLabel={strings.analysis.distributionAria}
      table={{
        columns: [
          strings.analysis.colMinistry,
          strings.stage.authority,
          strings.stage.spent,
          strings.pace.label,
        ],
        rows: [...points]
          .sort((a, b) => a.paceRatio - b.paceRatio)
          .map((point) => [point.name, point.authorityText, point.spentText, point.paceText]),
      }}
      onSelect={(id) => {
        const row = byId.get(id);
        if (row) router.push(localePath(`/ministry/${row.id}`, locale));
      }}
    />
  );
}
