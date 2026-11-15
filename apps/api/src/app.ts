import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Logger, LoggerOptions } from 'pino';
import type { Config } from './config';
import type { Database } from './db/client';
import { healthRoutes } from './routes/health';
import { homeRoutes } from './routes/homes';

export function loggerOptions(config: Config): LoggerOptions {
  const pretty = config.env === 'development' && process.stdout.isTTY;
  return {
    level: config.logLevel,
    ...(pretty && { transport: { target: 'pino-pretty', options: { colorize: true } } }),
  };
}

export async function buildApp(config: Config, database: Database, logger: Logger) {
  const app = Fastify({ loggerInstance: logger }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(
    async (api) => {
      await api.register(healthRoutes(database));
      await api.register(homeRoutes(database.db));
    },
    { prefix: '/api' },
  );

  return app;
}
