/**
 * Seed runner.
 *
 * Files in db/seed run in filename order and must be idempotent, because
 * seeding is re-run whenever reference data changes. Files numbered 90 and
 * above are demo-only and are skipped unless `--demo` is passed, which is the
 * mechanism that keeps illustrative figures out of a live deployment.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, getPool, query } from '../client';

const here = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(here, '..', '..', 'seed');

const DEMO_THRESHOLD = 90;

/**
 * Several Windows editors and PowerShell itself write UTF-8 with a byte order
 * mark. Postgres does not accept one at the head of a statement, and the
 * resulting "syntax error at or near" message points at an invisible character,
 * so the mark is removed here rather than left as a trap for whoever edits a
 * seed file next.
 */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function isDemoSeed(filename: string): boolean {
  const prefix = Number.parseInt(filename.slice(0, 2), 10);
  return Number.isFinite(prefix) && prefix >= DEMO_THRESHOLD;
}

async function seed(includeDemo: boolean): Promise<void> {
  const pool = getPool();
  const files = (await readdir(SEED_DIR)).filter((f) => f.endsWith('.sql')).sort();

  for (const filename of files) {
    if (isDemoSeed(filename) && !includeDemo) {
      console.log(`  skipped ${filename} (demo only, pass --demo to load)`);
      continue;
    }
    const sql = stripBom(await readFile(join(SEED_DIR, filename), 'utf8'));
    const started = Date.now();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      console.log(`  seeded ${filename} (${Date.now() - started}ms)`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(
        `Seed ${filename} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      client.release();
    }
  }

  // Derived views read the reference data, so they have to be rebuilt after a
  // seed or the dashboard keeps serving the previous state.
  await query('SELECT refresh_all_materialized_views(FALSE)');
  console.log('  refreshed materialized views');

  if (includeDemo) {
    console.log(
      '\nIllustrative sample data loaded. Set DATA_MODE=demo so the interface labels it.\n' +
        'These figures are not government figures and must not be cited.',
    );
  }
}

const includeDemo = process.argv.includes('--demo');

seed(includeDemo)
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closePool);
