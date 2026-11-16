import { pino } from 'pino';
import { buildApp, loggerOptions } from './app';
import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { seedHomes } from './db/seed';

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
    const files = config.seedFile ? [config.seedFile] : undefined;
    for (const result of await seedHomes(database.db, { files })) {
      app.log.info(result, 'seed finished');
    }
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
