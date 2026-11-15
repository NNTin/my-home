import { pino } from 'pino';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createDatabase } from '../src/db/client';
import { homes } from '../src/db/schema';

/**
 * Builds the app against in-memory PGlite, or against the Postgres in DATABASE_URL (CI).
 * Migrations run once per app; the sample table is emptied so each test starts clean.
 */
export async function createTestApp() {
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    PGLITE_DIR: 'memory://',
  });
  const logger = pino({ level: 'silent' });
  const database = createDatabase(config, logger);
  await database.migrate();
  await database.db.delete(homes);
  const app = await buildApp(config, database, logger);
  app.addHook('onClose', () => database.close());
  await app.ready();
  return { app, database };
}
