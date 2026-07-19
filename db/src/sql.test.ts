import { afterAll, describe, expect, it } from 'vitest';
import {
  NOT_REPORTED,
  decumulate,
  fiscalMonthIndex,
  fiscalQuarterOf,
  fiscalYearOf,
  fiscalYearRange,
  fractionOfFiscalYearElapsed,
  isNotReported,
  parseAmountCr,
  subtract,
  type Amount,
} from '@nidhi/core';
import { closePool, query } from './client';
import {
  getDefaultFiscalYear,
  getNationalSummary,
  getProvenanceMap,
  listMinistrySummaries,
} from './queries';

/**
 * Integration tests against a live Postgres.
 *
 * The fiscal-year helpers exist twice, once in TypeScript and once in SQL,
 * because the materialised views compute burn ratios in the database. Two
 * implementations of "when does the Indian financial year start" is a standing
 * invitation to drift, and drift here would corrupt every headline figure on
 * the site. These tests pin the two together by running the same cases through
 * both.
 *
 * Skipped when no database is reachable, so a contributor without Docker
 * running still gets a green unit-test suite. CI always has one.
 */

let databaseAvailable = false;
try {
  await query('SELECT 1');
  databaseAvailable = true;
} catch {
  databaseAvailable = false;
}

afterAll(async () => {
  await closePool();
});

const describeDb = databaseAvailable ? describe : describe.skip;

if (!databaseAvailable) {
  console.warn('[db] no database reachable, skipping SQL integration tests');
}

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describeDb('fiscal year helpers agree between SQL and TypeScript', () => {
  const cases = [
    '2025-03-31',
    '2025-04-01',
    '2025-06-30',
    '2025-07-01',
    '2025-12-31',
    '2026-01-01',
    '2026-03-31',
    '2026-04-01',
  ];

  it('assigns the same fiscal year to every boundary date', async () => {
    const rows = await query<{ d: string; fy: string }>(
      `SELECT d::TEXT AS d, fy_of(d) AS fy FROM unnest($1::DATE[]) AS d`,
      [cases],
    );
    for (const row of rows) {
      expect(row.fy, `SQL and TS disagree on ${row.d}`).toBe(fiscalYearOf(utc(row.d)));
    }
  });

  it('assigns the same FY-relative quarter, with April in Q1', async () => {
    const rows = await query<{ d: string; q: number }>(
      `SELECT d::TEXT AS d, fy_quarter(d) AS q FROM unnest($1::DATE[]) AS d`,
      [cases],
    );
    for (const row of rows) {
      expect(Number(row.q), `quarter mismatch on ${row.d}`).toBe(fiscalQuarterOf(utc(row.d)));
    }
  });

  it('numbers fiscal months identically, April as 1', async () => {
    const rows = await query<{ d: string; m: number }>(
      `SELECT d::TEXT AS d, fy_month_index(d) AS m FROM unnest($1::DATE[]) AS d`,
      [cases],
    );
    for (const row of rows) {
      expect(Number(row.m), `month index mismatch on ${row.d}`).toBe(fiscalMonthIndex(utc(row.d)));
    }
  });

  it('spans the same start and end dates', async () => {
    const rows = await query<{ fy: string; s: string; e: string }>(
      `SELECT fy, fy_start(fy)::TEXT AS s, fy_end(fy)::TEXT AS e
       FROM unnest($1::TEXT[]) AS fy`,
      [['FY2024', 'FY2025', 'FY2026']],
    );
    for (const row of rows) {
      const range = fiscalYearRange(row.fy);
      expect(row.s).toBe(range.startDate.toISOString().slice(0, 10));
      expect(row.e).toBe(range.endDate.toISOString().slice(0, 10));
    }
  });

  it('computes the same elapsed fraction, including across a leap day', async () => {
    // FY2024 contains 29 February 2024, so its denominator is 366.
    const probes: Array<[string, string]> = [
      ['FY2026', '2025-04-01'],
      ['FY2026', '2025-09-30'],
      ['FY2026', '2025-11-30'],
      ['FY2026', '2026-03-31'],
      ['FY2024', '2023-04-01'],
      ['FY2024', '2024-02-29'],
    ];
    for (const [fy, date] of probes) {
      const row = await query<{ f: string }>(`SELECT fy_fraction_elapsed($1, $2::DATE) AS f`, [
        fy,
        date,
      ]);
      const sqlValue = Number(row[0]!.f);
      const tsValue = fractionOfFiscalYearElapsed(fy, utc(date));
      expect(sqlValue, `elapsed fraction mismatch for ${fy} at ${date}`).toBeCloseTo(tsValue, 9);
    }
  });

  it('clamps outside the year at both ends rather than extrapolating', async () => {
    const rows = await query<{ before: string; after: string }>(
      `SELECT fy_fraction_elapsed('FY2026', '2020-01-01'::DATE) AS before,
              fy_fraction_elapsed('FY2026', '2030-01-01'::DATE) AS after`,
    );
    expect(Number(rows[0]!.before)).toBe(0);
    expect(Number(rows[0]!.after)).toBe(1);
  });

  it('rejects a malformed fiscal year instead of guessing', async () => {
    await expect(query(`SELECT fy_start('2026')`)).rejects.toThrow();
  });
});

describeDb('view invariants', () => {
  it('reports no errors from the invariant checks', async () => {
    const findings = await query<{ invariant: string; severity: string; detail: string }>(
      `SELECT * FROM check_invariants()`,
    );
    const errors = findings.filter((f) => f.severity === 'error');
    expect(errors, `invariant errors: ${JSON.stringify(errors)}`).toEqual([]);
  });

  it('never exposes a superseded fact', async () => {
    const rows = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM v_fiscal_fact_current v
       WHERE EXISTS (SELECT 1 FROM fiscal_fact s WHERE s.supersedes_fact_id = v.fact_id)`,
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it('derives balance as authority less expenditure, propagating absence', async () => {
    const rows = await query<{
      current_authority: string | null;
      expenditure_to_date: string | null;
      balance: string | null;
    }>(
      `SELECT current_authority, expenditure_to_date, balance
       FROM mv_ministry_summary LIMIT 200`,
    );
    if (rows.length === 0) return;
    for (const row of rows) {
      const expected: Amount = subtract(
        parseAmountCr(row.current_authority),
        parseAmountCr(row.expenditure_to_date),
      );
      const actual: Amount = parseAmountCr(row.balance);
      if (isNotReported(expected)) {
        // Absence must propagate: a missing input cannot yield a real balance.
        expect(actual).toBe(NOT_REPORTED);
      } else {
        expect(actual as number).toBeCloseTo(expected, 2);
      }
    }
  });

  it('de-cumulates monthly spend the same way the TypeScript does', async () => {
    const rows = await query<{
      entity_id: string;
      fiscal_month_index: number;
      cumulative_amount: string | null;
      monthly_amount: string | null;
    }>(
      `SELECT entity_id, fiscal_month_index, cumulative_amount, monthly_amount
       FROM mv_monthly_spend
       WHERE fy = (SELECT MAX(fy) FROM mv_monthly_spend) AND entity_type = 'ministry'
       ORDER BY entity_id, fiscal_month_index`,
    );
    if (rows.length === 0) return;

    const byEntity = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byEntity.get(row.entity_id) ?? [];
      list.push(row);
      byEntity.set(row.entity_id, list);
    }

    for (const [entityId, series] of byEntity) {
      const cumulative = series.map((row) => parseAmountCr(row.cumulative_amount));
      const expected = decumulate(cumulative).map((r) => r.monthly);
      const actual = series.map((row) => parseAmountCr(row.monthly_amount));
      for (let i = 0; i < expected.length; i += 1) {
        const want = expected[i]!;
        const got = actual[i]!;
        if (isNotReported(want)) expect(got, `${entityId} month ${i + 1}`).toBe(NOT_REPORTED);
        else expect(got as number, `${entityId} month ${i + 1}`).toBeCloseTo(want, 2);
      }
    }
  });

  it('keeps every fiscal fact attached to a source record', async () => {
    // Principle 1, checked against the data rather than only the constraint.
    const rows = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM fiscal_fact f
       LEFT JOIN source_record sr ON sr.source_record_id = f.source_record_id
       WHERE sr.source_record_id IS NULL`,
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it('never sums cumulative expenditure snapshots into the year-to-date total', async () => {
    // The classic failure: adding up twelve April-to-date figures and reporting
    // several times the actual spend. The view must select the latest snapshot,
    // so expenditure_to_date has to equal the maximum cumulative figure, never
    // the sum of them.
    const rows = await query<{
      entity_id: string;
      to_date: string | null;
      max_cumulative: string | null;
    }>(
      `SELECT m.ministry_id AS entity_id,
              m.expenditure_to_date AS to_date,
              (SELECT MAX(cumulative_amount) FROM mv_monthly_spend s
                WHERE s.fy = m.fy AND s.entity_type = 'ministry'
                  AND s.entity_id = m.ministry_id) AS max_cumulative
       FROM mv_ministry_summary m
       WHERE m.expenditure_to_date IS NOT NULL
       LIMIT 100`,
    );
    for (const row of rows) {
      if (row.max_cumulative === null) continue;
      expect(Number(row.to_date), `${row.entity_id} year-to-date`).toBeCloseTo(
        Number(row.max_cumulative),
        2,
      );
    }
  });
});

describeDb('provenance reaches the interface', () => {
  /**
   * These guard the single most important promise the product makes. The
   * failure mode is silent: every page still renders, every figure still shows,
   * and only the evidence behind them quietly disappears. It happened once
   * already, because `pg` returns BIGINT as a string and an id filter written
   * for numbers discarded all of them.
   */

  it('resolves provenance for ids exactly as the driver returns them', async () => {
    const rows = await query<{ id: number | string }>(
      `SELECT authority_source_record_id AS id FROM mv_ministry_summary
       WHERE authority_source_record_id IS NOT NULL LIMIT 5`,
    );
    if (rows.length === 0) return;
    const resolved = await getProvenanceMap(rows.map((row) => row.id));
    expect(resolved.size).toBe(new Set(rows.map((row) => Number(row.id))).size);
    for (const row of rows) {
      const provenance = resolved.get(Number(row.id));
      expect(provenance, `no provenance resolved for source_record_id ${row.id}`).toBeDefined();
      expect(provenance!.sourceName).toBeTruthy();
      expect(provenance!.fetchedAt).toBeTruthy();
    }
  });

  it('accepts a BIGINT id given as a string, which is how the driver hands it over', async () => {
    const rows = await query<{ id: number | string }>(
      `SELECT source_record_id AS id FROM source_record LIMIT 1`,
    );
    if (rows.length === 0) return;
    const asString = String(rows[0]!.id);
    const asNumber = Number(rows[0]!.id);
    expect((await getProvenanceMap([asString])).size).toBe(1);
    expect((await getProvenanceMap([asNumber])).size).toBe(1);
  });

  it('attaches provenance to the national headline figures', async () => {
    const fy = await getDefaultFiscalYear();
    if (!fy) return;
    const national = await getNationalSummary(fy);
    if (!national) return;
    // The hero figures on the front page. If either of these is null, the
    // provenance popover renders "no source record" under the most visible
    // numbers on the site.
    expect(national.provenance.authority, 'authority provenance').not.toBeNull();
    expect(national.provenance.expenditure, 'expenditure provenance').not.toBeNull();
  });

  it('attaches provenance to every ministry row that reports a figure', async () => {
    const fy = await getDefaultFiscalYear();
    if (!fy) return;
    const ministries = await listMinistrySummaries(fy, { limit: 25 });
    for (const ministry of ministries) {
      if (!isNotReported(ministry.currentAuthority)) {
        expect(ministry.provenance.authority, `${ministry.ministryId} authority`).not.toBeNull();
      }
      if (!isNotReported(ministry.expenditureToDate)) {
        expect(ministry.provenance.expenditure, `${ministry.ministryId} expenditure`).not.toBeNull();
      }
    }
  });

  it('ignores absent ids without dropping the ones that are present', async () => {
    const rows = await query<{ id: number | string }>(
      `SELECT source_record_id AS id FROM source_record LIMIT 1`,
    );
    if (rows.length === 0) return;
    const resolved = await getProvenanceMap([null, undefined, rows[0]!.id, null]);
    expect(resolved.size).toBe(1);
  });
});

describeDb('reference integrity', () => {
  it('points every alias at an entity that exists', async () => {
    const rows = await query<{ alias: string; entity_id: string; entity_type: string }>(
      `SELECT alias, entity_id, entity_type FROM entity_alias ea
       WHERE (ea.entity_type = 'ministry'
              AND NOT EXISTS (SELECT 1 FROM ministry m WHERE m.ministry_id = ea.entity_id))
          OR (ea.entity_type = 'scheme'
              AND NOT EXISTS (SELECT 1 FROM scheme s WHERE s.scheme_id = ea.entity_id))`,
    );
    expect(rows).toEqual([]);
  });

  it('declares every source a record was ingested under', async () => {
    const rows = await query<{ source_id: string }>(
      `SELECT DISTINCT sr.source_id FROM source_record sr
       WHERE NOT EXISTS (SELECT 1 FROM source_registry r WHERE r.source_id = sr.source_id)`,
    );
    expect(rows).toEqual([]);
  });

  it('agrees with the reference table on every fiscal year boundary', async () => {
    const rows = await query<{ fy: string }>(
      `SELECT fy FROM fiscal_year
       WHERE start_date <> fy_start(fy) OR end_date <> fy_end(fy)`,
    );
    expect(rows).toEqual([]);
  });
});
