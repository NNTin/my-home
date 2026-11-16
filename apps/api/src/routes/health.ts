import { HealthResponse, LiveResponse } from '@my-home/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Config } from '../config';
import type { Database } from '../db/client';

export const healthRoutes =
  (database: Database, config: Pick<Config, 'commit'>): FastifyPluginAsyncZod =>
  async (app) => {
    // Liveness: answers as long as the process serves requests. It must not depend on the
    // database, so a database outage marks the api not-ready (/health) without restarting it.
    app.get('/health/live', { schema: { response: { 200: LiveResponse } } }, async () => ({
      status: 'ok' as const,
      uptime: process.uptime(),
      commit: config.commit,
    }));

    app.get(
      '/health',
      { schema: { response: { 200: HealthResponse, 503: HealthResponse } } },
      async (request, reply) => {
        const uptime = process.uptime();
        const started = performance.now();
        try {
          await database.ping();
          return {
            status: 'ok' as const,
            uptime,
            db: {
              status: 'ok' as const,
              driver: database.driver,
              latencyMs: performance.now() - started,
            },
          };
        } catch (err) {
          request.log.error({ err }, 'database health check failed');
          return reply.code(503).send({
            status: 'error',
            uptime,
            // Details are logged above; never expose driver messages to callers.
            db: { status: 'error', driver: database.driver, error: 'database unavailable' },
          });
        }
      },
    );
  };
