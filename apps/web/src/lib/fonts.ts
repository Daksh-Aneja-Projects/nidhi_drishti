import { Inter, JetBrains_Mono, Noto_Sans_Devanagari } from 'next/font/google';

/**
 * One family carries the interface, and it is a contemporary grotesque.
 *
 * The previous pairing was IBM Plex across four roles, chosen for the vernacular
 * of a government form: condensed headings, a serif for prose, mono on every
 * figure. It was coherent and it read as a document from an archive.
 *
 * Inter instead, for the reasons a modern data product uses it. It was drawn for
 * screens at small sizes, it holds together from a 12px table label to a 72px
 * headline, and it ships genuine tabular figures. That last point is what lets
 * the money leave monospace: a column of rupee figures aligns because the
 * numerals are tabular, not because the letters are. Setting every figure in
 * mono made the product look like a terminal, which is not the same as looking
 * precise.
 *
 * Mono is kept for the things that genuinely are code: artifact keys, hashes and
 * source identifiers. JetBrains Mono rather than Plex Mono because it sits
 * better beside Inter at the same optical size.
 *
 * Devanagari is Noto Sans Devanagari, the companion Google drew for exactly this
 * pairing. Appended after Inter in every stack, so a Latin glyph is drawn from
 * Inter and a Devanagari glyph on the Hindi interface falls through to a face
 * designed to sit with it rather than to a mismatched system font.
 */

export const sans = Inter({
  subsets: ['latin'],
  // Variable, so the type scale can use weight as a real axis rather than
  // stepping between three static cuts.
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

export const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const devanagari = Noto_Sans_Devanagari({
  subsets: ['devanagari', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-devanagari',
  display: 'swap',
});

export const fontVariables = [sans.variable, mono.variable, devanagari.variable].join(' ');
