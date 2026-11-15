import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { seed } from './db/seed';

const database = createDatabase(loadConfig());
try {
  await database.migrate();
  const inserted = await seed(database.db);
  console.log(`seed finished: ${inserted} row(s) inserted (${database.driver})`);
} finally {
  await database.close();
}
