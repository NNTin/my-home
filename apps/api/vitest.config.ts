import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test files share one database when DATABASE_URL points at a real Postgres.
    fileParallelism: false,
    maxWorkers: 2,
    // Some tests build their own app: a cold in-memory PGlite plus the public, media and userdata
    // migrations take about 3 s alone, more under a parallel `pnpm test`.
    testTimeout: 15_000,
  },
});
