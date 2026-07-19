import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Load the monorepo's single root .env before any test module is imported.
 *
 * Vitest does not read it, and without DATABASE_URL the integration suite would
 * quietly skip every test and still report green, which is the worst possible
 * outcome for a suite whose whole job is catching drift between the SQL and the
 * TypeScript.
 */
const rootEnv = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}
