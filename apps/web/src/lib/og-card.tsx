import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import {
  BURN_BAND_LABELS,
  burnBand,
  burnColor,
  formatINRAuto,
  formatPercent,
  isNotReported,
  type Amount,
  type BurnMetrics,
  type DataMode,
} from '@nidhi/core';

/**
 * Share cards.
 *
 * docs/06 asks for auto-generated share cards carrying the burn gauge, because
 * a link pasted into a newsroom group is how this product actually reaches
 * people. The card is therefore the pace track and almost nothing else: the
 * same signature element as the site, at the one size where it has to work as a
 * standalone image with no page around it.
 *
 * Two constraints shape the implementation. Satori renders a subset of CSS, so
 * the hatching that means "uncertain" everywhere else is drawn as skewed divs
 * rather than a repeating gradient. And every card states the date its figures
 * are accounted to, because a screenshot outlives its context and a burn figure
 * without its date is not a fact.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = 'image/png';

const PALETTE = {
  paper: '#eff1ee',
  paperSunk: '#e4e7e3',
  ink: '#16202b',
  inkSoft: '#48555f',
  inkFaint: '#5f6b73',
  rule: '#ccd2cc',
  ruleStrong: '#9aa5a0',
  seal: '#9e2b25',
  unreported: '#666a65',
} as const;

const FONT_DIR = join(process.cwd(), 'src', 'assets', 'fonts');

/**
 * Fonts are read from disk and cached for the life of the process.
 *
 * Satori needs the raw binary, which is why these are vendored in the repo
 * rather than reused from next/font. Reading them per request would add a disk
 * hit to every card render.
 */
let fontCache: Array<{ name: string; data: Buffer; weight: 400 | 500 | 600; style: 'normal' }> | null =
  null;

/**
 * Each face is loaded as two subsets, and the `Ext` half is what carries the
 * rupee sign: U+20B9 sits in latin-ext, not latin. They are registered under
 * separate family names and referenced as a fallback chain, rather than relying
 * on Satori to guess, so a missing glyph resolves deterministically instead of
 * rendering the blank box that shipped in the first version of this card.
 */
const FONT_FILES: Array<{ name: string; file: string; weight: 400 | 500 | 600 }> = [
  { name: 'Condensed', file: 'plex-condensed-600.woff', weight: 600 },
  { name: 'CondensedExt', file: 'plex-condensed-600-ext.woff', weight: 600 },
  { name: 'Mono', file: 'plex-mono-500.woff', weight: 500 },
  { name: 'MonoExt', file: 'plex-mono-500-ext.woff', weight: 500 },
  { name: 'Sans', file: 'plex-sans-400.woff', weight: 400 },
  { name: 'SansExt', file: 'plex-sans-400-ext.woff', weight: 400 },
];

/** Font-family chains. Always use these, never a bare family name. */
const FAMILY = {
  condensed: 'Condensed, CondensedExt',
  mono: 'Mono, MonoExt',
  sans: 'Sans, SansExt',
} as const;

async function loadFonts() {
  if (fontCache) return fontCache;
  const loaded = await Promise.all(
    FONT_FILES.map(async (font) => ({
      name: font.name,
      data: await readFile(join(FONT_DIR, font.file)),
      weight: font.weight,
      style: 'normal' as const,
    })),
  );
  fontCache = loaded;
  return fontCache;
}

export interface ShareCardInput {
  eyebrow: string;
  title: string;
  authority: Amount;
  spent: Amount;
  balance: Amount;
  burn: BurnMetrics;
  asOf: string | null;
  dataMode: DataMode;
  /**
   * Labels for the three figures.
   *
   * Required rather than defaulted, because a ministry card compares
   * expenditure against a calendar and a scheme card compares releases against
   * an allocation. Those are different fiscal stages, and inheriting one card's
   * wording into the other is exactly the conflation CLAUDE.md principle 2
   * forbids. Making the caller state them makes the mistake hard to fall into.
   */
  labels: { authority: string; spent: string; balance: string };
  /** Sentence under the track saying what is being compared with what. */
  paceCaption: (input: { spent: string; reference: string }) => string;
  /**
   * Band label, or null to omit it.
   *
   * Omitted on the scheme card. The band wording ("behind pace", "ahead of
   * pace") describes progress against the calendar, and a scheme card compares
   * releases against an allocation instead. Printing "behind pace" there would
   * assert a schedule that nothing in the data establishes.
   */
  bandLabel?: string | null;
  /**
   * Whether to draw the reference marker.
   *
   * It represents "where the calendar had reached". With no calendar in the
   * comparison there is nothing for it to mark, and a rule at the far right
   * would read as a target the scheme is failing to meet.
   */
  showReferenceMarker?: boolean;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * Diagonal hatching, built from skewed bars.
 *
 * Satori does not render repeating-linear-gradient, so the pattern that carries
 * "this quantity is not settled" throughout the product is reconstructed here
 * from primitives it does support.
 */
function Hatching({ color }: { color: string }) {
  const bars = Array.from({ length: 60 }, (_, i) => i);
  return (
    // Explicit edges rather than `inset`, which Satori does not resolve.
    <div
      style={{
        display: 'flex',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden',
      }}
    >
      {bars.map((i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: i * 14 - 40,
            top: -20,
            width: 3,
            height: 140,
            backgroundColor: color,
            opacity: 0.5,
            transform: 'skewX(-45deg)',
          }}
        />
      ))}
    </div>
  );
}

function FigureBlock({ label, value }: { label: string; value: Amount }) {
  const unreported = isNotReported(value);
  return (
    // flex 1 with a zero basis so the three figures share the width evenly and
    // the longest one cannot push the last column off the right edge.
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
      <div
        style={{
          fontFamily: FAMILY.condensed,
          fontSize: 16,
          letterSpacing: 2,
          textTransform: 'uppercase',
          color: PALETTE.inkFaint,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: FAMILY.mono,
          fontSize: 34,
          color: unreported ? PALETTE.unreported : PALETTE.ink,
        }}
      >
        {formatINRAuto(value)}
      </div>
    </div>
  );
}

export async function renderShareCard(input: ShareCardInput): Promise<ImageResponse> {
  const fonts = await loadFonts();
  const paceKnown = !isNotReported(input.burn.pctSpent) && input.burn.pctFyElapsed > 0;

  const spentPos = paceKnown ? clampPercent(input.burn.pctSpent as number) : 0;
  const calendarPos = paceKnown ? clampPercent(input.burn.pctFyElapsed) : 0;
  const gapStart = Math.min(spentPos, calendarPos);
  const gapWidth = Math.abs(calendarPos - spentPos);
  const isBehind = spentPos < calendarPos;
  const accent = burnColor(input.burn.burnRatio);
  const showReferenceMarker = input.showReferenceMarker ?? true;
  const bandLabel =
    input.bandLabel === undefined
      ? BURN_BAND_LABELS[burnBand(input.burn.burnRatio)]
      : input.bandLabel;

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          backgroundColor: PALETTE.paper,
          padding: '48px 56px',
          fontFamily: FAMILY.sans,
        }}
      >
        {/* Illustrative data can never travel without saying so, and a share
            card is the single most detachable surface in the product. */}
        {input.dataMode === 'demo' ? (
          <div
            style={{
              display: 'flex',
              marginBottom: 20,
              borderLeft: `4px solid ${PALETTE.seal}`,
              paddingLeft: 12,
              fontSize: 18,
              color: PALETTE.seal,
            }}
          >
            Illustrative sample data. Not government figures.
          </div>
        ) : null}

        <div
          style={{
            display: 'flex',
            fontFamily: FAMILY.condensed,
            fontSize: 20,
            letterSpacing: 3,
            textTransform: 'uppercase',
            color: PALETTE.inkFaint,
          }}
        >
          {input.eyebrow}
        </div>

        <div
          style={{
            display: 'flex',
            fontFamily: FAMILY.condensed,
            fontSize: input.title.length > 44 ? 52 : 66,
            lineHeight: 1.05,
            color: PALETTE.ink,
            marginTop: 10,
          }}
        >
          {input.title}
        </div>

        {/* The pace track, at the one size where it has to carry the whole
            story on its own. */}
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}>
          <div style={{ display: 'flex', position: 'relative', height: 96 }}>
            <div
              style={{
                display: 'flex',
                position: 'absolute',
                left: 0,
                right: 0,
                top: 24,
                height: 48,
                backgroundColor: PALETTE.paperSunk,
                overflow: 'hidden',
              }}
            >
              {paceKnown ? (
                <div
                  style={{
                    display: 'flex',
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${spentPos}%`,
                    backgroundColor: accent,
                  }}
                />
              ) : (
                <Hatching color={PALETTE.unreported} />
              )}

              {paceKnown && gapWidth > 0.5 ? (
                <div
                  style={{
                    display: 'flex',
                    position: 'absolute',
                    left: `${gapStart}%`,
                    width: `${gapWidth}%`,
                    top: 0,
                    bottom: 0,
                    overflow: 'hidden',
                  }}
                >
                  <Hatching color={isBehind ? '#1f3a6e' : '#a8791c'} />
                </div>
              ) : null}
            </div>

            {/* Calendar marker: a full-height rule, the way a date line is
                drawn on a register. */}
            {paceKnown && showReferenceMarker ? (
              <div
                style={{
                  display: 'flex',
                  position: 'absolute',
                  left: `${calendarPos}%`,
                  top: 0,
                  bottom: 0,
                  width: 2,
                  backgroundColor: PALETTE.ink,
                }}
              />
            ) : null}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginTop: 6,
            }}
          >
            <div style={{ display: 'flex', fontSize: 22, color: PALETTE.inkSoft }}>
              {paceKnown
                ? input.paceCaption({
                    spent: formatPercent(input.burn.pctSpent, { decimals: 1 }),
                    reference: formatPercent(input.burn.pctFyElapsed, { decimals: 1 }),
                  })
                : 'This comparison cannot be computed from the reported figures'}
            </div>
            {paceKnown && bandLabel ? (
              // The band label is set in ink with the accent carried by a
              // swatch beside it. Colouring the text itself would make the
              // in-step label almost invisible, since that end of the scale is
              // deliberately close to the paper tone.
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ display: 'flex', width: 22, height: 12, backgroundColor: accent }} />
                <div
                  style={{
                    display: 'flex',
                    fontFamily: FAMILY.condensed,
                    fontSize: 22,
                    letterSpacing: 2,
                    textTransform: 'uppercase',
                    color: PALETTE.ink,
                  }}
                >
                  {bandLabel}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 34,
            paddingTop: 24,
            borderTop: `2px solid ${PALETTE.ruleStrong}`,
          }}
        >
          <FigureBlock label={input.labels.authority} value={input.authority} />
          <FigureBlock label={input.labels.spent} value={input.spent} />
          <FigureBlock label={input.labels.balance} value={input.balance} />
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 24,
            fontSize: 17,
            color: PALETTE.inkFaint,
          }}
        >
          <div style={{ display: 'flex' }}>
            {input.asOf
              ? `Expenditure accounted to ${input.asOf}. Compiled from cited public sources.`
              : 'Compiled from cited public sources.'}
          </div>
          <div style={{ display: 'flex', fontFamily: FAMILY.condensed, letterSpacing: 2 }}>
            NIDHI DRISHTI
          </div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: fonts.map((font) => ({
        name: font.name,
        data: font.data as unknown as ArrayBuffer,
        weight: font.weight,
        style: font.style,
      })),
    },
  );
}

/** Format a date for the card. Kept local so the card never depends on the DOM. */
export function formatCardDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}
