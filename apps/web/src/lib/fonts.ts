import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Condensed, IBM_Plex_Serif } from 'next/font/google';

/**
 * Three type roles, one superfamily.
 *
 * Condensed sans for headings and labels, borrowed from the vernacular of
 * government forms where column width is scarce. Serif for prose, which is what
 * the methodology pages and the AI narratives are. Mono for every rupee figure,
 * because tabular figures have to align down a column and because mono reads as
 * "accounted", which is precisely the claim being made about these numbers.
 *
 * Plex rather than a more fashionable pairing because it carries Devanagari in
 * all three roles. The Hindi interface in docs/07 will need it, and picking a
 * family now that cannot do it would mean rebuilding the type system later.
 */

export const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
  display: 'swap',
});

export const plexCondensed = IBM_Plex_Sans_Condensed({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-plex-condensed',
  display: 'swap',
});

export const plexSerif = IBM_Plex_Serif({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-serif',
  display: 'swap',
});

export const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const fontVariables = [
  plexSans.variable,
  plexCondensed.variable,
  plexSerif.variable,
  plexMono.variable,
].join(' ');
