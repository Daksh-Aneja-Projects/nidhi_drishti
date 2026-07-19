import { describe, expect, it } from 'vitest';
import { NOT_REPORTED } from './money';
import { renderCsvPreamble, toCsv, type CsvColumn } from './csv';

interface Row {
  name: string;
  be: number | typeof NOT_REPORTED;
  note: string;
}

const columns: CsvColumn<Row>[] = [
  { key: 'name', header: 'Ministry', value: (r) => r.name },
  { key: 'be', header: 'BE (INR crore)', value: (r) => r.be },
  { key: 'note', header: 'Note', value: (r) => r.note },
];

describe('toCsv', () => {
  it('writes a header row and one row per record', () => {
    const csv = toCsv([{ name: 'Health', be: 100, note: 'ok' }], columns);
    expect(csv).toBe('Ministry,BE (INR crore),Note\nHealth,100,ok\n');
  });

  it('exports raw crore numbers, not formatted strings, so the CSV is machine readable', () => {
    const csv = toCsv([{ name: 'Health', be: 1234567.89, note: '' }], columns);
    expect(csv).toContain('1234567.89');
    expect(csv).not.toContain('12,34,567.89');
  });

  it('writes "Not reported" rather than an empty cell that reads as zero', () => {
    const csv = toCsv([{ name: 'Health', be: NOT_REPORTED, note: '' }], columns);
    expect(csv).toContain('Health,Not reported,');
  });

  it('quotes cells containing commas, quotes or newlines', () => {
    const csv = toCsv([{ name: 'Home, Ministry of', be: 1, note: 'said "yes"' }], columns);
    expect(csv).toContain('"Home, Ministry of"');
    expect(csv).toContain('"said ""yes"""');
  });

  it('defuses spreadsheet formula injection', () => {
    const csv = toCsv([{ name: '=1+1', be: 1, note: '@SUM(A1)' }], columns);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'@SUM(A1)");
  });

  it('emits only the header when there are no rows', () => {
    expect(toCsv([], columns)).toBe('Ministry,BE (INR crore),Note\n');
  });
});

describe('renderCsvPreamble', () => {
  const preamble = {
    title: 'Ministry allocations',
    fy: 'FY2026',
    generatedAt: '2026-07-20T00:00:00.000Z',
    siteUrl: 'https://example.org',
    sources: [
      {
        name: 'CGA Monthly Accounts',
        url: 'https://cga.nic.in/doc',
        documentDate: '2026-06-30',
      },
    ],
  };

  it('attaches sources so an exported figure stays checkable', () => {
    const text = renderCsvPreamble(preamble);
    expect(text).toContain('# Underlying sources:');
    expect(text).toContain('CGA Monthly Accounts');
    expect(text).toContain('https://cga.nic.in/doc');
    expect(text).toContain('document dated 2026-06-30');
  });

  it('spells out that "Not reported" is not zero', () => {
    expect(renderCsvPreamble(preamble)).toContain('They are not zero.');
  });

  it('comments every preamble line so parsers can skip them', () => {
    for (const line of renderCsvPreamble(preamble).split('\n')) {
      expect(line.startsWith('#')).toBe(true);
    }
  });

  it('says so explicitly when no sources are recorded', () => {
    expect(renderCsvPreamble({ ...preamble, sources: [] })).toContain('(none recorded)');
  });

  it('is prepended above the header row when passed to toCsv', () => {
    const csv = toCsv([{ name: 'Health', be: 1, note: '' }], columns, preamble);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('# Ministry allocations');
    expect(lines).toContain('Ministry,BE (INR crore),Note');
  });
});
