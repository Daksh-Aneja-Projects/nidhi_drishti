import { describe, expect, it } from 'vitest';
import { burnColor, burnLegend } from './burn';
import { NOT_REPORTED } from './money';

/**
 * Contrast floors for the palette.
 *
 * These are asserted rather than eyeballed because the failure is invisible to
 * anyone whose eyesight and screen are good: the eyebrow label tone shipped at
 * 3.77:1 and looked completely fine. On a data product read on phones in
 * daylight, a label nobody can read is a figure nobody can interpret.
 *
 * Thresholds are WCAG 2.1 AA: 4.5:1 for normal text, 3:1 for graphical objects
 * and large text.
 */

const PAPER = '#eff1ee';

function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '');
  const r = channelLuminance(parseInt(value.slice(0, 2), 16));
  const g = channelLuminance(parseInt(value.slice(2, 4), 16));
  const b = channelLuminance(parseInt(value.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Mirrors the @theme block in apps/web/src/app/globals.css. Kept here so the
 * palette is testable without a browser; the design-system doc names this file
 * as the check on those values.
 */
const TEXT_TONES: Record<string, string> = {
  ink: '#16202b',
  'ink-soft': '#48555f',
  'ink-faint': '#5f6b73',
  unreported: '#666a65',
  seal: '#9e2b25',
  behind: '#1f3a6e',
};

describe('text contrast against paper', () => {
  it.each(Object.entries(TEXT_TONES))('%s clears 4.5:1', (name, hex) => {
    const ratio = contrastRatio(hex, PAPER);
    expect(ratio, `${name} (${hex}) is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the eyebrow label readable, since it labels every figure on the site', () => {
    // Regression: this tone shipped at 3.77:1.
    expect(contrastRatio(TEXT_TONES['ink-faint']!, PAPER)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps "Not reported" legible rather than hiding it', () => {
    // Absence is signalled by hue and hatching. Making it hard to see would
    // turn "the source does not publish this" into "there is nothing here",
    // which is exactly the confusion the label exists to prevent.
    expect(contrastRatio(TEXT_TONES['unreported']!, PAPER)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('pace scale as a graphical object', () => {
  function channels(hex: string): [number, number, number] {
    const v = hex.replace('#', '');
    return [
      parseInt(v.slice(0, 2), 16),
      parseInt(v.slice(2, 4), 16),
      parseInt(v.slice(4, 6), 16),
    ];
  }

  /** Rough perceptual distance. Good enough to catch two stops reading alike. */
  function colorDistance(a: string, b: string): number {
    const [r1, g1, b1] = channels(a);
    const [r2, g2, b2] = channels(b);
    return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
  }

  /**
   * Position on the blue to yellow axis, which is the one that survives the
   * common red-green colour vision deficiencies. This is the axis the whole
   * scale is built on, so it is the one worth asserting.
   */
  function blueYellow(hex: string): number {
    const [r, g, b] = channels(hex);
    return b - (r + g) / 2;
  }

  it('carries the signal at the ends, where it matters', () => {
    // Only the outer stops are held to 3:1. The near-midpoint stops are
    // deliberately close to the paper tone: an entity in step with the calendar
    // should recede so that genuine outliers come forward. That is the central
    // idea of the scale, and colour is never the sole encoding anyway. Every
    // treemap tile is labelled, the pace is stated in words, and the chart has
    // a data-table fallback.
    for (const ratio of [0, 0.3, 1.5, 1.7, 2]) {
      const contrast = contrastRatio(burnColor(ratio), PAPER);
      expect(contrast, `burn ${ratio} is ${contrast.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });

  it('separates the missing-data swatch from the paper it sits on', () => {
    const contrast = contrastRatio(burnColor(NOT_REPORTED), PAPER);
    expect(contrast, `unreported swatch is ${contrast.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });

  it('puts behind and ahead on opposite sides of the blue to yellow axis', () => {
    // Behind pace must be bluer than paper and ahead of pace yellower. This is
    // what a red-green colourblind reader actually distinguishes, and a
    // luminance ratio cannot express it: two dark colours of opposite hue score
    // low on contrast while remaining perfectly distinguishable.
    expect(blueYellow(burnColor(0.3))).toBeGreaterThan(20);
    expect(blueYellow(burnColor(1.7))).toBeLessThan(-20);
  });

  it('keeps every legend entry distinguishable from its neighbours', () => {
    const colors = burnLegend().map((entry) => entry.color);
    expect(new Set(colors).size).toBe(colors.length);
    for (let i = 0; i < colors.length - 1; i += 1) {
      const distance = colorDistance(colors[i]!, colors[i + 1]!);
      expect(distance, `legend stops ${i} and ${i + 1} read alike`).toBeGreaterThan(30);
    }
  });

  it('keeps the two ends of the scale far apart perceptually', () => {
    expect(colorDistance(burnColor(0.3), burnColor(1.7))).toBeGreaterThan(120);
  });
});
