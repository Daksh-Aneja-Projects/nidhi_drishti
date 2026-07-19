/**
 * CSV export shared by the download buttons and the public API.
 *
 * Exports carry a provenance preamble as comment lines, because a CSV that
 * leaves the site without its sources attached is exactly the artifact that
 * ends up quoted with no way to check it.
 */

import { NOT_REPORTED, isNotReported, type Amount } from './money';

export type CsvCell = string | number | boolean | null | undefined | Amount;

export interface CsvColumn<Row> {
  key: string;
  header: string;
  value: (row: Row) => CsvCell;
}

export interface CsvPreamble {
  title: string;
  fy: string;
  generatedAt: string;
  siteUrl: string;
  sources: Array<{ name: string; url: string | null; documentDate: string | null }>;
  notice?: string;
}

function escapeCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return '';
  if (isNotReported(cell as Amount)) return 'Not reported';
  if (typeof cell === 'boolean') return cell ? 'true' : 'false';
  if (typeof cell === 'number') {
    return Number.isFinite(cell) ? String(cell) : '';
  }
  const text = String(cell);
  // Defuse spreadsheet formula injection: a leading =, +, - or @ makes Excel
  // and Sheets evaluate the cell. Prefixing with an apostrophe keeps it text.
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

/** Render the provenance comment block that heads every export. */
export function renderCsvPreamble(preamble: CsvPreamble): string {
  const lines = [
    `# ${preamble.title}`,
    `# Fiscal year: ${preamble.fy}`,
    `# Generated: ${preamble.generatedAt}`,
    `# Source of this export: ${preamble.siteUrl}`,
  ];
  if (preamble.notice) lines.push(`# Notice: ${preamble.notice}`);
  lines.push('# Underlying sources:');
  if (preamble.sources.length === 0) {
    lines.push('#   (none recorded)');
  }
  for (const source of preamble.sources) {
    const parts = [source.name];
    if (source.documentDate) parts.push(`document dated ${source.documentDate}`);
    if (source.url) parts.push(source.url);
    lines.push(`#   ${parts.join(', ')}`);
  }
  lines.push(
    '# Figures marked "Not reported" are absent from the source. They are not zero.',
  );
  return lines.join('\n');
}

/** Serialise rows to CSV with the provenance preamble attached. */
export function toCsv<Row>(
  rows: readonly Row[],
  columns: readonly CsvColumn<Row>[],
  preamble?: CsvPreamble,
): string {
  const out: string[] = [];
  if (preamble) out.push(renderCsvPreamble(preamble), '');
  out.push(columns.map((c) => escapeCell(c.header)).join(','));
  for (const row of rows) {
    out.push(columns.map((c) => escapeCell(c.value(row))).join(','));
  }
  // Trailing newline so the file ends cleanly for line-oriented tooling.
  return `${out.join('\n')}\n`;
}

/** Amount accessor for CSV columns: exports the raw crore number, not the formatted string. */
export function csvAmount(value: Amount): CsvCell {
  return isNotReported(value) ? NOT_REPORTED : value;
}
