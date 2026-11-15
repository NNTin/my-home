import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test files share one database when DATABASE_URL points at a real Postgres.
    fileParallelism: false,
    maxWorkers: 2,
  },
});
