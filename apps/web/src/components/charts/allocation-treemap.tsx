'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { EChartsOption } from 'echarts';
import { Chart, baseChartOption, chartTheme } from '@/components/chart';
import { strings } from '@/lib/strings';

/**
 * Ministries sized by spending authority, coloured by pace.
 *
 * Props are deliberately plain data. `Amount` carries a symbol for absence,
 * which cannot cross the server to client boundary, so the page formats every
 * figure before it reaches this component and an unreported value arrives as
 * `null` rather than as a zero.
 */

export interface TreemapItem {
  id: string;
  name: string;
  /** Spending authority in crore. Items with no reported authority are omitted. */
  value: number;
  /** From `burnColor(burn.burnRatio)` in @nidhi/core. Never invented here. */
  color: string;
  authorityText: string;
  spentText: string;
  paceText: string;
}

/** Ledger ink on brass, paper on indigo: keep the label legible on every tile. */
function labelColorOn(hex: string): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? chartTheme.ink : chartTheme.paperRaised;
}

interface AllocationTreemapProps {
  items: TreemapItem[];
  fy: string;
  height?: number;
}

export function AllocationTreemap({ items, fy, height = 460 }: AllocationTreemapProps) {
  const router = useRouter();

  const byName = useMemo(
    () => new Map(items.map((item) => [item.name, item])),
    [items],
  );

  const option = useMemo<EChartsOption>(() => {
    return {
      ...baseChartOption,
      grid: undefined,
      tooltip: {
        ...baseChartOption.tooltip,
        formatter: (params: unknown) => {
          const name = (params as { name?: string }).name ?? '';
          const data = byName.get(name);
          if (!data) return '';
          return [
            `<strong>${escapeHtml(data.name)}</strong>`,
            `${escapeHtml(strings.stage.authority)}: ${escapeHtml(data.authorityText)}`,
            `${escapeHtml(strings.stage.spent)}: ${escapeHtml(data.spentText)}`,
            `${escapeHtml(strings.pace.label)}: ${escapeHtml(data.paceText)}`,
          ].join('<br/>');
        },
      },
      series: [
        {
          type: 'treemap',
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          animationDuration: 400,
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          itemStyle: {
            borderColor: chartTheme.paper,
            borderWidth: 1,
            gapWidth: 1,
            borderRadius: 0,
          },
          label: {
            show: true,
            fontFamily: 'var(--font-plex-sans), system-ui, sans-serif',
            fontSize: 11,
            lineHeight: 14,
            overflow: 'break',
            position: 'insideTopLeft',
            padding: [2, 4, 0, 4],
            formatter: (params: unknown) => {
              const name = (params as { name?: string }).name ?? '';
              const data = byName.get(name);
              return data ? `${data.name}\n${data.authorityText}` : '';
            },
          },
          upperLabel: { show: false },
          data: items.map((item) => ({
            name: item.name,
            value: item.value,
            itemStyle: { color: item.color },
            label: { color: labelColorOn(item.color) },
          })),
        },
      ],
    };
  }, [items, byName]);

  const table = useMemo(
    () => ({
      columns: [
        strings.common.ministry,
        strings.stage.authority,
        strings.stage.spent,
        strings.pace.label,
      ],
      rows: items.map((item) => [item.name, item.authorityText, item.spentText, item.paceText]),
    }),
    [items],
  );

  return (
    <Chart
      chartId="overview_allocation_treemap"
      option={option}
      height={height}
      ariaLabel={strings.overview.treemapHelp}
      table={table}
      onSelect={(name) => {
        const match = items.find((item) => item.name === name);
        if (match) router.push(`/ministry/${encodeURIComponent(match.id)}?fy=${fy}`);
      }}
    />
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
