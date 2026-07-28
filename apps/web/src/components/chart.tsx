'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { Table } from 'lucide-react';
import { Icon } from '@/components/icon';
import { useStrings } from '@/components/locale-provider';
import { track } from '@/lib/analytics';

/** Minimal surface of an ECharts instance, so the module stays type-only imported. */
interface EChartsInstance {
  setOption: (option: EChartsOption, notMerge?: boolean) => void;
  resize: () => void;
  dispose: () => void;
  on: (event: string, handler: (params: unknown) => void) => void;
  off: (event: string, handler: (params: unknown) => void) => void;
}

let echartsPromise: Promise<{
  init: (el: HTMLElement, theme?: unknown, opts?: { renderer: 'canvas' }) => EChartsInstance;
}> | null = null;

/**
 * Load ECharts on demand, once per session.
 *
 * A static import puts the whole charting library in the first load of every
 * page that draws anything, which took the chart pages to roughly 400 kB and
 * past the LCP budget in docs/06. Journalists read this on phones on mobile
 * data, so the library is code split and fetched after the page is interactive.
 * The figures themselves are server rendered text and the data-table fallback
 * is already in the DOM, so nothing a reader needs waits on this.
 */
async function loadECharts() {
  if (!echartsPromise) {
    echartsPromise = (async () => {
      const [core, charts, components, renderers] = await Promise.all([
        import('echarts/core'),
        import('echarts/charts'),
        import('echarts/components'),
        import('echarts/renderers'),
      ]);
      core.use([
        charts.BarChart,
        charts.LineChart,
        charts.TreemapChart,
        charts.CustomChart,
        // The variance dumbbell and the pace distribution are both scatter.
        // echarts is tree shaken here, so a series type that is not registered
        // renders an empty canvas with only a console warning to say why.
        charts.ScatterChart,
        components.GridComponent,
        components.TooltipComponent,
        components.LegendComponent,
        components.DatasetComponent,
        components.MarkLineComponent,
        renderers.CanvasRenderer,
      ]);
      return core as unknown as {
        init: (el: HTMLElement, theme?: unknown, opts?: { renderer: 'canvas' }) => EChartsInstance;
      };
    })();
  }
  return echartsPromise;
}

/**
 * Base chart wrapper.
 *
 * Three things every chart in this product gets for free, none of which are
 * optional:
 *
 *  - the shared theme, so a chart cannot introduce a colour outside the token
 *    set and quietly imply a meaning the palette does not carry;
 *  - a data-table fallback (docs/06 accessibility), because a chart that cannot
 *    be read by a screen reader or copied into a spreadsheet is not a
 *    transparency artifact;
 *  - a typed interaction event, so chart usage shows up in the analytics
 *    taxonomy rather than as an untracked black box.
 */

/**
 * Literal values rather than `var(--color-*)`: echarts renders to canvas, which
 * resolves no custom properties. These must be kept in step with the tokens in
 * globals.css by hand, and a test pins the pair.
 */
export const chartTheme = {
  ink: '#e9ecf2',
  inkSoft: '#a3aabb',
  inkFaint: '#7f8798',
  paper: '#14171f',
  paperRaised: '#1a1e28',
  paperSunk: '#10131a',
  rule: '#262b38',
  ruleStrong: '#38404f',
  behind: '#5b93f5',
  behindSoft: '#2f4a7a',
  ahead: '#e0a040',
  aheadSoft: '#6d5324',
  onPace: '#7e86a0',
  seal: '#e4708e',
  accent: '#7c8aec',
  brass: '#e0a040',
  unreported: '#7e86a0',
} as const;

/**
 * Shared axis, grid and tooltip styling, spread into every chart.
 *
 * The interaction defaults matter as much as the colours. A chart that only
 * redraws is a picture; a chart that responds under the cursor is an
 * instrument, and the difference is almost entirely in these few settings:
 * an axis pointer that tracks precisely, a tooltip that appears without lag
 * and does not jitter, and an entry animation short enough to read as
 * responsiveness rather than as decoration.
 */
export const baseChartOption: EChartsOption = {
  backgroundColor: 'transparent',
  textStyle: {
    fontFamily: 'var(--font-sans), system-ui, sans-serif',
    color: chartTheme.ink,
  },
  // Fast, eased, and staggered only slightly. Long chart animations are the
  // clearest tell of a template dashboard.
  animationDuration: 420,
  animationEasing: 'cubicOut',
  animationDelay: (index: number) => index * 12,
  grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
  tooltip: {
    backgroundColor: chartTheme.paperRaised,
    borderColor: chartTheme.rule,
    borderWidth: 1,
    borderRadius: 8,
    padding: [10, 12],
    textStyle: { color: chartTheme.ink, fontSize: 12, fontWeight: 400 },
    // No transition on the follow, so the tooltip tracks the cursor exactly.
    transitionDuration: 0.12,
    confine: true,
    axisPointer: {
      type: 'line',
      lineStyle: { color: chartTheme.ruleStrong, width: 1, type: [4, 4] },
      crossStyle: { color: chartTheme.ruleStrong },
      label: { show: false },
    },
    extraCssText:
      'box-shadow: 0 16px 40px -12px rgba(0,0,0,0.65); border-radius: 8px;' +
      'backdrop-filter: saturate(1.3) blur(8px);',
  },
};

/**
 * Tooltip markup shared by every chart.
 *
 * Written once because a tooltip is where most of a chart's information
 * actually gets read, and three charts hand-rolling their own HTML is how a
 * product ends up with three different ideas of what a label looks like.
 */
export function tooltipHtml(
  title: string,
  rows: Array<{ label: string; value: string; color?: string }>,
): string {
  const head =
    `<div style="font-weight:600;font-size:12.5px;margin-bottom:6px;` +
    `max-width:280px;white-space:normal;line-height:1.35">${title}</div>`;
  const body = rows
    .map(
      (row) =>
        `<div style="display:flex;align-items:center;gap:8px;` +
        `justify-content:space-between;margin-top:3px">` +
        `<span style="display:flex;align-items:center;gap:6px;color:${chartTheme.inkFaint}">` +
        (row.color
          ? `<span style="width:7px;height:7px;border-radius:2px;background:${row.color}"></span>`
          : '') +
        `${row.label}</span>` +
        `<span style="font-variant-numeric:tabular-nums;font-weight:500">${row.value}</span>` +
        `</div>`,
    )
    .join('');
  return head + body;
}

export const axisLabelStyle = {
  color: chartTheme.inkFaint,
  fontSize: 11,
  fontFamily: 'var(--font-sans), system-ui, sans-serif',
} as const;

interface ChartProps {
  /** Stable id, used for the `chart_interacted` analytics event. */
  chartId: string;
  option: EChartsOption;
  height?: number;
  ariaLabel: string;
  /** Rows rendered by the table fallback. Required: every chart has one. */
  table: {
    columns: string[];
    rows: Array<Array<string | number>>;
  };
  onSelect?: (name: string) => void;
}

export function Chart({ chartId, option, height = 280, ariaLabel, table, onSelect }: ChartProps) {
  const strings = useStrings();
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<EChartsInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  useEffect(() => {
    let disposed = false;
    let instance: EChartsInstance | null = null;
    let resizeObserver: ResizeObserver | null = null;

    void (async () => {
      const echarts = await loadECharts();
      // The component can unmount while the library is still downloading.
      if (disposed || !containerRef.current) return;
      instance = echarts.init(containerRef.current, undefined, { renderer: 'canvas' });
      instanceRef.current = instance;
      resizeObserver = new ResizeObserver(() => instance?.resize());
      resizeObserver.observe(containerRef.current);
      setReady(true);
    })();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      instance?.dispose();
      instanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance || !ready) return;
    // `true` replaces the option wholesale, so a series that disappears between
    // renders is actually removed rather than merged and left on screen.
    instance.setOption(option, true);
  }, [option, ready]);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance || !ready) return;
    function handleClick(params: unknown) {
      const name = (params as { name?: string }).name;
      track('chart_interacted', { chart_id: chartId, action: 'drill' });
      if (name && onSelect) onSelect(name);
    }
    instance.on('click', handleClick);
    return () => {
      instance.off('click', handleClick);
    };
  }, [chartId, onSelect, ready]);

  return (
    <figure className="m-0">
      <div
        ref={containerRef}
        style={{ height, cursor: onSelect ? 'pointer' : 'default' }}
        role="img"
        aria-label={ariaLabel}
        aria-describedby={showTable ? tableId : undefined}
      />

      <figcaption className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => {
            setShowTable((previous) => !previous);
            track('chart_interacted', { chart_id: chartId, action: 'table_fallback' });
          }}
          aria-expanded={showTable}
          aria-controls={tableId}
          className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] uppercase tracking-wider text-[color:var(--color-ink-faint)] transition-colors hover:text-[color:var(--color-ink)]"
        >
          <Icon icon={Table} size="xs" />
          {showTable ? strings.common.hideTable : strings.common.showTable}
        </button>
      </figcaption>

      {/* Always in the DOM so assistive technology can reach it through
          aria-describedby, visually hidden until asked for. */}
      <div id={tableId} className={showTable ? 'table-scroll mt-2' : 'sr-only'}>
        <table className="data-table">
          <caption className="sr-only">{ariaLabel}</caption>
          <thead>
            <tr>
              {table.columns.map((column, index) => (
                <th key={column} scope="col" className={index === 0 ? '' : 'num'}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className={cellIndex === 0 ? '' : 'num'}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
