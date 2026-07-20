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

export const chartTheme = {
  ink: '#16202b',
  inkSoft: '#48555f',
  inkFaint: '#6f7c85',
  paper: '#eff1ee',
  paperRaised: '#f8f9f7',
  paperSunk: '#e4e7e3',
  rule: '#ccd2cc',
  ruleStrong: '#9aa5a0',
  behind: '#1f3a6e',
  behindSoft: '#93a6c6',
  ahead: '#a8791c',
  aheadSoft: '#d3b06a',
  onPace: '#c9ccc4',
  seal: '#9e2b25',
  unreported: '#a4a9a2',
} as const;

/** Shared axis, grid and tooltip styling, spread into every chart option. */
export const baseChartOption: EChartsOption = {
  backgroundColor: 'transparent',
  textStyle: {
    fontFamily: 'var(--font-plex-sans), system-ui, sans-serif',
    color: chartTheme.ink,
  },
  grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
  tooltip: {
    backgroundColor: chartTheme.paperRaised,
    borderColor: chartTheme.ruleStrong,
    borderWidth: 1,
    // Square, like everything else in this system.
    borderRadius: 2,
    padding: [8, 10],
    textStyle: { color: chartTheme.ink, fontSize: 12 },
    extraCssText: 'box-shadow: 0 4px 16px rgba(22,32,43,0.12);',
  },
};

export const axisLabelStyle = {
  color: chartTheme.inkFaint,
  fontSize: 11,
  fontFamily: 'var(--font-plex-mono), monospace',
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
        style={{ height }}
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
