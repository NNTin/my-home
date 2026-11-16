import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { resetDatabase } from './db/reset';
import { seed } from './db/seed';

// Staging deploys: empty the database, migrate, seed the mock home. Refuses to run unless
// ALLOW_DATABASE_RESET=true, so it can never wipe a database by accident.
const config = loadConfig();
if (!config.allowDatabaseReset) {
  console.error('refusing to reset the database: ALLOW_DATABASE_RESET is not true');
  process.exit(1);
}

const database = createDatabase(config, { error: (obj, msg) => console.error(msg, obj) });
try {
  await resetDatabase(database.db);
  await database.migrate();
  const result = await seed(database.db, { file: config.seedFile });
  console.log(`database reset: migrations applied, home "${result.id}" ${result.status}`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await database.close();
}
