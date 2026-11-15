import { pino } from 'pino';
import { buildApp, loggerOptions } from './app';
import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { seed } from './db/seed';

const config = loadConfig();
const logger = pino(loggerOptions(config));
const database = createDatabase(config, logger);
const app = await buildApp(config, database, logger);
app.addHook('onClose', () => database.close());

try {
  if (config.migrateOnStart) {
    await database.migrate();
    app.log.info({ driver: database.driver }, 'migrations applied');
  }
  if (config.seedOnStart) {
    const inserted = await seed(database.db);
    app.log.info({ inserted }, 'seed finished');
  }
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.fatal({ err }, 'failed to start');
  await app.close();
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(() => process.exit(0));
  });
}
