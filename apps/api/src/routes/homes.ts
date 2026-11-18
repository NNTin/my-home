import {
  ApiError,
  HomeModel,
  HomeParams,
  HomeSettings,
  HomeSettingsParams,
  ListHomesQuery,
  ListHomesResponse,
  PutHomeSettingsBody,
  UseConflict,
} from '@my-home/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { resolveActor } from '../actor';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { homeSettingsStore, withSettings } from '../db/home-settings';
import { homeStore } from '../db/homes';

/** The release job replaces every home in data/homes from git on each deploy (docs/deployment.md). */
export const REPLACED_ON_DEPLOY = '299 - "Replaced from data/homes on the next deploy"';

const notFound = (id: string) => ({
  statusCode: 404,
  error: 'Not Found',
  message: `Home "${id}" not found`,
});

/**
 * Request bodies are validated with the shared HomeModel; failures become 400s (see app.ts).
 * Reads return the effective model: the stored (git) document with the home's settings on top.
 */
export const homeRoutes =
  (db: Db, config: Pick<Config, 'agentUsernames'>): FastifyPluginAsyncZod =>
  async (app) => {
    const store = homeStore(db);
    const settings = homeSettingsStore(db);
    const effective = async (id: string) => {
      const model = await store.get(id);
      return model && withSettings(model, await settings.find(id));
    };

    app.get(
      '/homes',
      { schema: { querystring: ListHomesQuery, response: { 200: ListHomesResponse } } },
      async (request) => ({ items: await store.list(request.query.limit) }),
    );

    app.get(
      '/homes/:id',
      { schema: { params: HomeParams, response: { 200: HomeModel, 404: ApiError } } },
      async (request, reply) => {
        const model = await effective(request.params.id);
        return model ?? reply.code(404).send(notFound(request.params.id));
      },
    );

    // Agents' experiments on staging; the next deploy's sync from git replaces the model.

    app.put(
      '/homes/:id',
      {
        schema: {
          params: HomeParams,
          body: HomeModel,
          response: { 200: HomeModel, 400: ApiError, 404: ApiError },
        },
      },
      async (request, reply) => {
        const { id } = request.params;
        if (request.body.id !== id) {
          const message = `Body id "${request.body.id}" does not match the URL id "${id}"`;
          return reply.code(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message,
            issues: [{ path: 'id', message }],
          });
        }
        if (!(await store.replace(request.body))) return reply.code(404).send(notFound(id));
        // What a GET now answers: the settings stay on top of the replaced model.
        return reply
          .header('warning', REPLACED_ON_DEPLOY)
          .send(withSettings(request.body, await settings.find(id)));
      },
    );

    // Creates the home, or replaces the one with the same id (until the next deploy's sync).
    app.post(
      '/homes/import',
      { schema: { body: HomeModel, response: { 200: HomeModel, 201: HomeModel, 400: ApiError } } },
      async (request, reply) => {
        const status = await store.upsert(request.body);
        return reply
          .code(status === 'created' ? 201 : 200)
          .header('warning', REPLACED_ON_DEPLOY)
          .send(withSettings(request.body, await settings.find(request.body.id)));
      },
    );

    // The model as a downloadable, pretty-printed home file that `import` accepts unchanged.
    app.get('/homes/:id/export', { schema: { params: HomeParams } }, async (request, reply) => {
      const model = await effective(request.params.id);
      if (!model) return reply.code(404).send(notFound(request.params.id));
      return reply
        .type('application/json; charset=utf-8')
        .header('content-disposition', `attachment; filename="${model.id}.json"`)
        .send(`${JSON.stringify(model, null, 2)}\n`);
    });

    // The settings stored on top of the git model (the magnetic declination), kept by every sync.
    app.get(
      '/homes/:homeId/settings',
      { schema: { params: HomeSettingsParams, response: { 200: HomeSettings, 404: ApiError } } },
      async (request) => settings.get(request.params.homeId),
    );

    app.put(
      '/homes/:homeId/settings',
      {
        schema: {
          params: HomeSettingsParams,
          body: PutHomeSettingsBody,
          response: { 200: HomeSettings, 400: ApiError, 404: ApiError, 409: UseConflict },
        },
      },
      async (request) =>
        settings.put(request.params.homeId, request.body, resolveActor(request.headers, config)),
    );
  };
