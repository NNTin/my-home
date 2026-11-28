import { loadConfig } from './core/config';
import { createDatabase } from './db/client';
import { runRelease } from './db/release';

// The pre-deploy hook of every environment (charts/my-home/templates/release.yaml): validate the
// home files, reset `public` on staging (RESET_PUBLIC), migrate, then sync data/homes from git.
// A failure exits 1, so Helm aborts the upgrade and the old version keeps serving.
const config = loadConfig();
const database = createDatabase(config, { error: (obj, msg) => console.error(msg, obj) });
try {
  await runRelease(database, config, { info: console.log, warn: console.warn });
} catch (err) {
  console.error(`release failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await database.close();
}
