/**
 * Vendor the font files the share-card renderer needs.
 *
 * Satori, which renders the OG images, cannot use the fonts that next/font
 * loads for the browser: it needs the raw binary at render time, and it does
 * not read woff2, which is what a modern browser is served.
 *
 * Two subsets are fetched per face. The `latin` subset does not contain the
 * rupee sign, U+20B9, which lives in `latin-ext` (U+20AD to U+20CF). Loading
 * only `latin` renders every figure on every share card with a blank box where
 * the currency symbol should be, which is a hard failure for a product whose
 * entire output is rupee figures.
 *
 * The files are committed rather than downloaded during the build, so a build
 * works offline and cannot silently start producing cards in a fallback face
 * because a CDN was briefly unreachable. The typography is the identity here.
 *
 * Run with: node scripts/fetch-og-fonts.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps',
  'web',
  'src',
  'assets',
  'fonts',
);

const VERSION = '5.1.1';

const FACES = [
  { out: 'plex-condensed-600', pkg: 'ibm-plex-sans-condensed', weight: 600 },
  { out: 'plex-mono-500', pkg: 'ibm-plex-mono', weight: 500 },
  { out: 'plex-sans-400', pkg: 'ibm-plex-sans', weight: 400 },
];

const SUBSETS = ['latin', 'latin-ext'];

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  for (const face of FACES) {
    for (const subset of SUBSETS) {
      const url = `https://cdn.jsdelivr.net/npm/@fontsource/${face.pkg}@${VERSION}/files/${face.pkg}-${subset}-${face.weight}-normal.woff`;
      const bytes = await download(url);
      const name = subset === 'latin' ? `${face.out}.woff` : `${face.out}-ext.woff`;
      await writeFile(join(OUT_DIR, name), bytes);
      console.log(`  ${name.padEnd(30)} ${(bytes.length / 1024).toFixed(1)} kB`);
    }
  }

  console.log(`\nWrote ${FACES.length * SUBSETS.length} font files to ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
