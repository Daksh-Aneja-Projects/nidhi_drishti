/**
 * Forward-only migration runner.
 *
 * Migrations are plain SQL applied in filename order and recorded with a
 * checksum. Editing an already-applied migration is refused rather than
 * silently ignored: on a project whose entire value is the auditability of its
 * numbers, a schema that differs between two deployments claiming the same
 * version is not an acceptable failure mode.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, getPool } from '../client';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, '..', '..', 'migrations');

interface AppliedMigration {
  filename: string;
  checksum: string;
}

async function ensureMigrationTable(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      filename    TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      duration_ms INT
    )
  `);
}

function checksum(sql: string): string {
  // Normalise line endings so a checkout on Windows does not appear to have
  // rewritten every migration.
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

export async function migrate(): Promise<void> {
  await ensureMigrationTable();
  const pool = getPool();

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const { rows: applied } = await pool.query<AppliedMigration>(
    'SELECT filename, checksum FROM schema_migration',
  );
  const appliedByName = new Map(applied.map((row) => [row.filename, row.checksum]));

  let appliedCount = 0;

  for (const filename of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8');
    const hash = checksum(sql);
    const previous = appliedByName.get(filename);

    if (previous !== undefined) {
      if (previous !== hash) {
        throw new Error(
          `Migration ${filename} has changed since it was applied.\n` +
            'Migrations are immutable once applied. Add a new migration instead, ' +
            'or run "pnpm db:reset" if this is a local database you can discard.',
        );
      }
      continue;
    }

    const started = Date.now();
    const client = await pool.connect();
    try {
      // Each migration is one transaction, so a failure half way through leaves
      // no partially applied schema behind.
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migration (filename, checksum, duration_ms) VALUES ($1, $2, $3)',
        [filename, hash, Date.now() - started],
      );
      await client.query('COMMIT');
      console.log(`  applied ${filename} (${Date.now() - started}ms)`);
      appliedCount += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(
        `Migration ${filename} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      client.release();
    }
  }

  console.log(
    appliedCount === 0
      ? 'Schema already up to date.'
      : `Applied ${appliedCount} migration${appliedCount === 1 ? '' : 's'}.`,
  );
}

// This module is a CLI entry point, invoked only via "pnpm db:migrate".
migrate()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closePool);
