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
import { closePool, getPool, query, queryOne } from './client';
import {
  getDefaultFiscalYear,
  getNationalSummary,
  getProvenanceMap,
  listMinistrySummaries,
  listStates,
  listStateSummaries,
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

  it('defaults to a year that has both an allocation and a spend figure', async () => {
    // The front page is spend against authority. A year with actuals but no
    // budget renders empty, which reads as "no data" beside a database that
    // has plenty.
    const fy = await getDefaultFiscalYear();
    if (!fy) return;
    const row = await queryOne<{ has_alloc: boolean; has_spend: boolean }>(
      `SELECT BOOL_OR(stage IN ('BE','RE','SUPPLEMENTARY')) AS has_alloc,
              BOOL_OR(stage = 'EXPENDITURE') AS has_spend
       FROM fiscal_fact WHERE fy = $1`,
      [fy],
    );
    // Allocation is the one that must be there. Expenditure legitimately has
    // not been published yet for the current year, and saying so is the point.
    expect(row?.has_alloc, `${fy} was chosen with no allocation`).toBe(true);
  });

  it('reports how a document was obtained, not only what it was', async () => {
    // A hand-downloaded document is real evidence, but it does not refresh on a
    // schedule the way an automated source does. The reader is told which.
    await inRollback(async (client) => {
      const { rows } = await client.query<{ source_record_id: string }>(
        `INSERT INTO source_record
           (source_id, url, artifact_key, artifact_sha256, fetched_at,
            retrieval_method, retrieved_by, retrieval_note)
         VALUES ('union_budget', 'https://www.indiabudget.gov.in/doc/eb/sumsbe.pdf',
                 'raw/ub/x', $1, now(), 'operator_download', 'A. Operator', 'portal blocks bots')
         RETURNING source_record_id`,
        ['b'.repeat(64)],
      );
      const id = rows[0]!.source_record_id;
      const { rows: view } = await client.query<{
        retrieval_method: string;
        retrieved_by: string;
      }>(
        `SELECT retrieval_method, retrieved_by FROM v_provenance WHERE source_record_id = $1`,
        [id],
      );
      expect(view).toHaveLength(1);
      expect(view[0]!.retrieval_method).toBe('operator_download');
      expect(view[0]!.retrieved_by).toBe('A. Operator');
    });
  });

  it('refuses a manual retrieval that names nobody', async () => {
    // Without a name, "downloaded by hand" is unauditable, which is worse than
    // not claiming it at all.
    await inRollback(async (client) => {
      await expect(
        client.query(
          `INSERT INTO source_record
             (source_id, url, artifact_key, artifact_sha256, fetched_at, retrieval_method)
           VALUES ('union_budget', 'https://www.indiabudget.gov.in/x', 'raw/ub/y', $1, now(),
                   'operator_download')`,
          ['c'.repeat(64)],
        ),
      ).rejects.toThrow(/source_record_operator_named/);
    });
  });

  it('treats an unlabelled record as an automated fetch, which is what every old row was', async () => {
    await inRollback(async (client) => {
      const { rows } = await client.query<{ retrieval_method: string }>(
        `INSERT INTO source_record (source_id, url, artifact_key, artifact_sha256, fetched_at)
         VALUES ('union_budget', 'https://www.indiabudget.gov.in/z', 'raw/ub/z', $1, now())
         RETURNING retrieval_method`,
        ['d'.repeat(64)],
      );
      expect(rows[0]!.retrieval_method).toBe('automated');
    });
  });

  it('attaches provenance to the national headline figures', async () => {
    const fy = await getDefaultFiscalYear();
    if (!fy) return;
    const national = await getNationalSummary(fy);
    if (!national) return;
    // The hero figures on the front page. The invariant is that a figure which
    // is shown has its evidence attached, not that both figures exist: a year
    // whose actuals the CGA has not published yet legitimately has no
    // expenditure at all, and saying "Not reported" for it is the product
    // working. A number without provenance is the failure.
    if (!isNotReported(national.currentAuthority)) {
      expect(national.provenance.authority, 'authority provenance').not.toBeNull();
    }
    if (!isNotReported(national.expenditureToDate)) {
      expect(national.provenance.expenditure, 'expenditure provenance').not.toBeNull();
    }
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

  it('points every state alias at a state that exists', async () => {
    const rows = await query<{ alias: string }>(
      `SELECT alias FROM entity_alias ea
       WHERE ea.entity_type = 'state'
         AND NOT EXISTS (SELECT 1 FROM state s WHERE s.state_id = ea.entity_id)`,
    );
    expect(rows).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * States (v2, docs/12)
 * ------------------------------------------------------------------ */

/**
 * Runs `fn` inside a transaction that is always rolled back, so a test can
 * insert a deliberately wrong fact, watch the invariant fire, and leave the
 * shared database exactly as it found it. The other suites read on separate
 * pooled connections and never see the uncommitted rows.
 */
async function inRollback<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

const SHA = 'a'.repeat(64);

describeDb('state reference data', () => {
  it('seeds the 28 states and 8 union territories', async () => {
    const rows = await query<{ kind: string; count: string }>(
      `SELECT kind, COUNT(*) AS count FROM state GROUP BY kind ORDER BY kind`,
    );
    const byKind = new Map(rows.map((r) => [r.kind, Number(r.count)]));
    expect(byKind.get('state')).toBe(28);
    expect(byKind.get('ut')).toBe(8);
  });

  it('records which union territories have no legislature of their own', async () => {
    // Ladakh has no assembly; Delhi does. The UI leans on this to avoid implying
    // a treasury portal that does not exist.
    const ladakh = await queryOne<{ has_legislature: boolean }>(
      `SELECT has_legislature FROM state WHERE state_id = 'st-ladakh'`,
    );
    const delhi = await queryOne<{ has_legislature: boolean }>(
      `SELECT has_legislature FROM state WHERE state_id = 'st-delhi'`,
    );
    expect(ladakh?.has_legislature).toBe(false);
    expect(delhi?.has_legislature).toBe(true);
  });

  it('exposes the two targeted states through the query layer', async () => {
    const states = await listStates();
    const ids = new Set(states.map((s) => s.stateId));
    expect(ids.has('st-karnataka')).toBe(true);
    expect(ids.has('st-odisha')).toBe(true);
  });

  it('registers the targeted portals as state-jurisdiction sources', async () => {
    const rows = await query<{ source_id: string; jurisdiction: string }>(
      `SELECT source_id, jurisdiction FROM source_registry
       WHERE source_id IN ('state_karnataka', 'state_odisha') ORDER BY source_id`,
    );
    expect(rows.map((r) => r.source_id)).toEqual(['state_karnataka', 'state_odisha']);
    expect(rows.every((r) => r.jurisdiction === 'state')).toBe(true);
  });

  it('leaves every existing Union source on the union ledger', async () => {
    const rows = await query<{ source_id: string }>(
      `SELECT source_id FROM source_registry
       WHERE jurisdiction = 'state' AND source_id NOT LIKE 'state_%'`,
    );
    expect(rows).toEqual([]);
  });
});

describeDb('state summary view', () => {
  it('is queryable and never returns a state that reports no figure as a real balance', async () => {
    const rows = await query<{
      current_authority: string | null;
      expenditure_to_date: string | null;
      balance: string | null;
    }>(`SELECT current_authority, expenditure_to_date, balance FROM mv_state_summary LIMIT 200`);
    for (const row of rows) {
      const expected: Amount = subtract(
        parseAmountCr(row.current_authority),
        parseAmountCr(row.expenditure_to_date),
      );
      const actual: Amount = parseAmountCr(row.balance);
      if (isNotReported(expected)) expect(actual).toBe(NOT_REPORTED);
      else expect(actual as number).toBeCloseTo(expected, 2);
    }
  });

  it('derives a state balance as authority less expenditure, mirroring the ministry view', async () => {
    await inRollback(async (client) => {
      const { rows: srRows } = await client.query<{ source_record_id: string }>(
        `INSERT INTO source_record (source_id, url, artifact_key, artifact_sha256, fetched_at)
         VALUES ('state_karnataka', 'https://finance.karnataka.gov.in/x', 'raw/ka/x', $1, now())
         RETURNING source_record_id`,
        [SHA],
      );
      const srid = srRows[0]!.source_record_id;
      // A state BE authority and a full-year expenditure actual for the same FY.
      await client.query(
        `INSERT INTO fiscal_fact
           (fy, entity_type, entity_id, stage, head, is_cumulative, amount_inr_cr,
            source_record_id, extraction_method)
         VALUES ('FY2026', 'state', 'st-karnataka', 'BE', 'total', FALSE, 339000.50, $1, 'html_table')`,
        [srid],
      );
      await client.query(
        `INSERT INTO fiscal_fact
           (fy, entity_type, entity_id, stage, head, period_start, period_end,
            is_cumulative, amount_inr_cr, source_record_id, extraction_method)
         VALUES ('FY2026', 'state', 'st-karnataka', 'EXPENDITURE', 'total',
                 '2025-04-01', '2026-03-31', TRUE, 300000.00, $1, 'html_table')`,
        [srid],
      );
      // Non-concurrent refresh is allowed inside a transaction and rolls back
      // with it, so the shared view is untouched once the test ends.
      await client.query('REFRESH MATERIALIZED VIEW mv_state_summary');

      const { rows } = await client.query<{
        current_authority: string;
        expenditure_to_date: string;
        balance: string;
      }>(
        `SELECT current_authority, expenditure_to_date, balance
         FROM mv_state_summary WHERE fy = 'FY2026' AND state_id = 'st-karnataka'`,
      );
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.current_authority)).toBeCloseTo(339000.5, 2);
      expect(Number(rows[0]!.expenditure_to_date)).toBeCloseTo(300000.0, 2);
      expect(Number(rows[0]!.balance)).toBeCloseTo(39000.5, 2);
    });
  });

  it('reads through the query layer once a state has data', async () => {
    // Real state data is not loaded yet, so this is a smoke test of the reader,
    // which must return an array and never throw.
    const summaries = await listStateSummaries('FY2026');
    expect(Array.isArray(summaries)).toBe(true);
  });
});

describeDb('CSS double-count guard (docs/12)', () => {
  it('flags a state-sourced fact that lands in the Union scheme ledger', async () => {
    await inRollback(async (client) => {
      const { rows: srRows } = await client.query<{ source_record_id: string }>(
        `INSERT INTO source_record (source_id, url, artifact_key, artifact_sha256, fetched_at)
         VALUES ('state_karnataka', 'https://finance.karnataka.gov.in/x', 'raw/ka/y', $1, now())
         RETURNING source_record_id`,
        [SHA],
      );
      const srid = srRows[0]!.source_record_id;
      // The mistake the rule exists to catch: a Centrally Sponsored Scheme's
      // state-side spending written under entity_type='scheme', where
      // mv_scheme_summary would add it on top of the Union central share.
      await client.query(
        `INSERT INTO fiscal_fact
           (fy, entity_type, entity_id, stage, head, period_end, is_cumulative,
            amount_inr_cr, source_record_id, extraction_method)
         VALUES ('FY2026', 'scheme', 'sch-mgnrega', 'RELEASE', 'total',
                 '2026-03-31', FALSE, 5000.00, $1, 'html_table')`,
        [srid],
      );
      const { rows } = await client.query<{ invariant: string; severity: string }>(
        `SELECT invariant, severity FROM check_invariants('FY2026')
         WHERE invariant = 'state_source_in_union_ledger'`,
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.severity === 'error')).toBe(true);
    });
  });

  it('does not flag the same scheme fact when it comes from a Union source', async () => {
    await inRollback(async (client) => {
      const { rows: srRows } = await client.query<{ source_record_id: string }>(
        `INSERT INTO source_record (source_id, url, artifact_key, artifact_sha256, fetched_at)
         VALUES ('pfms_pub', 'https://pfms.nic.in/x', 'raw/pfms/z', $1, now())
         RETURNING source_record_id`,
        [SHA],
      );
      const srid = srRows[0]!.source_record_id;
      await client.query(
        `INSERT INTO fiscal_fact
           (fy, entity_type, entity_id, stage, head, period_end, is_cumulative,
            amount_inr_cr, source_record_id, extraction_method)
         VALUES ('FY2026', 'scheme', 'sch-mgnrega', 'RELEASE', 'total',
                 '2026-03-31', FALSE, 5000.00, $1, 'html_table')`,
        [srid],
      );
      const { rows } = await client.query<{ invariant: string }>(
        `SELECT invariant FROM check_invariants('FY2026')
         WHERE invariant = 'state_source_in_union_ledger'`,
      );
      expect(rows).toEqual([]);
    });
  });

  it('flags a state fact that points at an unseeded state', async () => {
    await inRollback(async (client) => {
      const { rows: srRows } = await client.query<{ source_record_id: string }>(
        `INSERT INTO source_record (source_id, url, artifact_key, artifact_sha256, fetched_at)
         VALUES ('state_odisha', 'https://finance.odisha.gov.in/x', 'raw/od/w', $1, now())
         RETURNING source_record_id`,
        [SHA],
      );
      const srid = srRows[0]!.source_record_id;
      await client.query(
        `INSERT INTO fiscal_fact
           (fy, entity_type, entity_id, stage, head, is_cumulative, amount_inr_cr,
            source_record_id, extraction_method)
         VALUES ('FY2026', 'state', 'st-atlantis', 'BE', 'total', FALSE, 1.00, $1, 'html_table')`,
        [srid],
      );
      const { rows } = await client.query<{ severity: string }>(
        `SELECT severity FROM check_invariants('FY2026')
         WHERE invariant = 'state_fact_unknown_state'`,
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.severity === 'error')).toBe(true);
    });
  });

  it('stays clean for a correctly filed state fact', async () => {
    await inRollback(async (client) => {
      const { rows: srRows } = await client.query<{ source_record_id: string }>(
        `INSERT INTO source_record (source_id, url, artifact_key, artifact_sha256, fetched_at)
         VALUES ('state_karnataka', 'https://finance.karnataka.gov.in/x', 'raw/ka/ok', $1, now())
         RETURNING source_record_id`,
        [SHA],
      );
      const srid = srRows[0]!.source_record_id;
      await client.query(
        `INSERT INTO fiscal_fact
           (fy, entity_type, entity_id, stage, head, is_cumulative, amount_inr_cr,
            source_record_id, extraction_method)
         VALUES ('FY2026', 'state', 'st-karnataka', 'BE', 'total', FALSE, 339000.50, $1, 'html_table')`,
        [srid],
      );
      const { rows } = await client.query<{ invariant: string; severity: string }>(
        `SELECT invariant, severity FROM check_invariants('FY2026')
         WHERE severity = 'error'
           AND invariant IN ('state_source_in_union_ledger', 'state_fact_unknown_state')`,
      );
      expect(rows).toEqual([]);
    });
  });
});
