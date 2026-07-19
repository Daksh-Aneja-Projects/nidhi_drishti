/**
 * Postgres access.
 *
 * One pool per process. Two type-safety decisions worth knowing about:
 *
 *  1. NUMERIC is parsed as a *string*, not a float. `pg` does this by default
 *     and we deliberately keep it: rupee figures in crore are stored to two
 *     decimal places and rounding them through a double at the driver boundary
 *     would silently alter published numbers. Parse at the display edge with
 *     `parseAmountCr` from @nidhi/core instead.
 *
 *  2. DATE is parsed as a plain `YYYY-MM-DD` string rather than a JS Date.
 *     A fiscal document's date is a calendar day, and letting the driver build
 *     a Date in the server's local timezone is how "31 March" becomes
 *     "30 March" on a machine running west of UTC.
 */

import pg from 'pg';

const { Pool, types } = pg;

// 1082 = DATE. Keep the calendar day exactly as Postgres wrote it.
types.setTypeParser(1082, (value: string) => value);

let pool: pg.Pool | null = null;

export interface DbConfig {
  connectionString: string;
  max?: number;
  statementTimeoutMs?: number;
}

export function resolveConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env, then run "pnpm db:up" to start Postgres.',
    );
  }
  return url;
}

export function getPool(config?: Partial<DbConfig>): pg.Pool {
  if (pool) return pool;
  const connectionString = config?.connectionString ?? resolveConnectionString();
  pool = new Pool({
    connectionString,
    max: config?.max ?? 10,
    // A runaway analytical query must not hold a web request open indefinitely.
    statement_timeout: config?.statementTimeoutMs ?? 15_000,
    ssl: /sslmode=require/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
  });
  pool.on('error', (error) => {
    // An idle client erroring out is a pool-level event with no request to
    // attach it to, so it is logged rather than thrown.
    console.error('[db] idle client error', error);
  });
  return pool;
}

export async function query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<Row[]> {
  const result = await getPool().query<Row>(text, params as unknown[]);
  return result.rows;
}

/** Query expecting at most one row. Returns null rather than undefined. */
export async function queryOne<Row extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<Row | null> {
  const rows = await query<Row>(text, params);
  return rows[0] ?? null;
}

/** Run a function inside a transaction, rolling back on any throw. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Health probe for /api/health. Returns latency in milliseconds. */
export async function pingDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
