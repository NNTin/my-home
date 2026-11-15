import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Config } from './config';
import type { Database } from './db/client';
import { healthRoutes } from './routes/health';
import { homeRoutes } from './routes/homes';

function loggerOptions(config: Config): FastifyServerOptions['logger'] {
  const pretty = config.env === 'development' && process.stdout.isTTY;
  return {
    level: config.logLevel,
    ...(pretty && { transport: { target: 'pino-pretty', options: { colorize: true } } }),
  };
}

export async function buildApp(config: Config, database: Database) {
  const app = Fastify({ logger: loggerOptions(config) }).withTypeProvider<ZodTypeProvider>();
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
