import { loadConfig } from './core/config';
import { createDatabase } from './db/client';

const database = createDatabase(loadConfig(), { error: (obj, msg) => console.error(msg, obj) });
try {
  await database.migrate();
  console.log(`migrations applied (${database.driver})`);
} finally {
  await database.close();
}
