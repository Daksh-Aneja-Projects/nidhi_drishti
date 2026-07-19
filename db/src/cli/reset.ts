/**
 * Drop and recreate the public schema, then migrate and seed.
 *
 * Destructive by design and refuses to run against anything that does not look
 * like a local database, because the one thing worse than losing a development
 * database is losing the artifact trail behind published figures.
 */

import { closePool, getPool, resolveConnectionString } from '../client';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', 'host.docker.internal', 'postgres'];

function assertLocal(connectionString: string): void {
  let host: string;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    throw new Error('DATABASE_URL could not be parsed, refusing to reset.');
  }
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `Refusing to reset a non-local database (host "${host}").\n` +
        'This command drops every table. If you really mean to reset a remote ' +
        'database, do it deliberately with psql.',
    );
  }
}

async function reset(): Promise<void> {
  const connectionString = resolveConnectionString();
  assertLocal(connectionString);

  await getPool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  console.log('Dropped and recreated schema "public".');
  console.log('Now run: pnpm db:migrate && pnpm db:seed');
}

reset()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closePool);
