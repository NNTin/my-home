import { pino } from 'pino';
import { buildApp, loggerOptions } from './app';
import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { describeImports, importLayouts } from './db/layout-import';
import { photoStore } from './db/photos';
import { placementStore } from './db/placements';
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
  if (config.migrateOnStart) {
    // Local dev: the one-time layout import the release job runs on deployed environments.
    const imported = await importLayouts(database.db, {
      retentionDays: config.userdataTrashRetentionDays,
      warn: (line) => app.log.warn(line),
    });
    const { info, warn } = describeImports(imported);
    info.forEach((line) => app.log.info(line));
    warn.forEach((line) => app.log.warn(line));
  }
  await app.listen({ host: config.host, port: config.port });

  // Photos and requests deleted longer ago than the retention period leave the trash for good.
  const photos = photoStore(database.db, { retentionDays: config.photoTrashRetentionDays });
  // Placements removed longer ago leave theirs with their history (their ids are never reused).
  const placements = placementStore(database.db, {
    retentionDays: config.userdataTrashRetentionDays,
  });
  const purgeExpired = () =>
    Promise.all([
      photos.purgeExpired().then(
        (result) => {
          if (result.purgedPhotos + result.purgedRequests > 0) app.log.info(result, 'trash purged');
        },
        (err: unknown) => app.log.error({ err }, 'purging the trash failed'),
      ),
      placements.purgeExpired().then(
        (result) => {
          if (result.purgedPlacements > 0) app.log.info(result, 'placement trash purged');
        },
        (err: unknown) => app.log.error({ err }, 'purging the placement trash failed'),
      ),
    ]);
  void purgeExpired();
  setInterval(() => void purgeExpired(), 60 * 60 * 1000).unref();
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
