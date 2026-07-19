/**
 * Rebuild the materialised views. Called at the end of every pipeline run and
 * available manually for when a view definition changes.
 */

import { closePool, query } from '../client';

const useConcurrent = !process.argv.includes('--blocking');

query('SELECT refresh_all_materialized_views($1)', [useConcurrent])
  .then(() => {
    console.log(`Refreshed materialized views${useConcurrent ? ' concurrently' : ''}.`);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    // CONCURRENTLY refuses to run against a view that has never been populated,
    // which is the normal state immediately after migrating a fresh database.
    if (/has not been populated/.test(message)) {
      console.error(
        'A materialized view has never been populated. Run "pnpm db:seed" first, ' +
          'or re-run this command with --blocking.',
      );
    } else {
      console.error(message);
    }
    process.exitCode = 1;
  })
  .finally(closePool);
