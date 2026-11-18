import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Logger, LoggerOptions } from 'pino';
import type { Config } from './config';
import type { Database } from './db/client';
import { errorHandler } from './errors';
import { catalogRoutes } from './routes/catalog';
import { healthRoutes } from './routes/health';
import { homeRoutes } from './routes/homes';
import { layoutRoutes } from './routes/layouts';
import { noteRoutes } from './routes/notes';
import { openingOverrideRoutes } from './routes/opening-overrides';
import { photoRoutes } from './routes/photos';
import { placementRoutes } from './routes/placements';
import { useRoutes } from './routes/uses';

export function loggerOptions(config: Config): LoggerOptions {
  const pretty = config.env === 'development' && process.stdout.isTTY;
  return {
    level: config.logLevel,
    ...(pretty && { transport: { target: 'pino-pretty', options: { colorize: true } } }),
  };
}

export async function buildApp(config: Config, database: Database, logger: Logger) {
  // Home documents are a few hundred kB; leave head-room for detailed real-world models.
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: 10 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);

  await app.register(
    async (api) => {
      await api.register(healthRoutes(database, config));
      await api.register(homeRoutes(database.db, config));
      await api.register(layoutRoutes(database.db));
      await api.register(photoRoutes(database.db, config));
      await api.register(catalogRoutes(database.db, config));
      await api.register(useRoutes(database.db, config));
      await api.register(placementRoutes(database.db, config));
      await api.register(openingOverrideRoutes(database.db, config));
      await api.register(noteRoutes(database.db, config));
    },
    { prefix: '/api' },
  );

  return app;
}
