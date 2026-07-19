import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // The suite talks to a real Postgres, so it is slower than a unit suite and
    // must not run files in parallel against the same database.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
