import {
  ApiError,
  CreateLayoutBody,
  DuplicateLayoutBody,
  Layout,
  LayoutConflict,
  LayoutFile,
  LayoutHomeParams,
  LayoutParams,
  ListLayoutsResponse,
  UpdateLayoutBody,
} from '@my-home/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Db } from '../db/client';
import { layoutStore } from '../db/layouts';

const notFound = (kind: 'Home' | 'Layout', id: string) => ({
  statusCode: 404,
  error: 'Not Found',
  message: `${kind} "${id}" not found`,
});

/** Layout files are downloaded under a readable name: `<layout name>.layout.json`. */
const fileName = (name: string) =>
  `${name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'layout'}.layout.json`;

/**
 * Named furniture layouts per home. Bodies are validated with the shared schemas; `PUT` is a full
 * replace guarded by `version` (optimistic concurrency) and answers 409 when it is stale.
 */
export const layoutRoutes =
  (db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    const store = layoutStore(db);

    app.get(
      '/homes/:homeId/layouts',
      {
        schema: {
          params: LayoutHomeParams,
          response: { 200: ListLayoutsResponse, 404: ApiError },
        },
      },
      async (request, reply) => {
        const items = await store.list(request.params.homeId);
        return items ? { items } : reply.code(404).send(notFound('Home', request.params.homeId));
      },
    );

    app.post(
      '/homes/:homeId/layouts',
      {
        schema: {
          params: LayoutHomeParams,
          body: CreateLayoutBody,
          response: { 201: Layout, 400: ApiError, 404: ApiError },
        },
      },
      async (request, reply) => {
        const { homeId } = request.params;
        const layout = await store.create(homeId, request.body.name, request.body.items);
        if (!layout) return reply.code(404).send(notFound('Home', homeId));
        return reply.code(201).send(layout);
      },
    );

    // Creates a new layout from a layout file (any `id`/`homeId` in the file are ignored).
    app.post(
      '/homes/:homeId/layouts/import',
      {
        schema: {
          params: LayoutHomeParams,
          body: LayoutFile,
          response: { 201: Layout, 400: ApiError, 404: ApiError },
        },
      },
      async (request, reply) => {
        const { homeId } = request.params;
        const layout = await store.create(homeId, request.body.name, request.body.items);
        if (!layout) return reply.code(404).send(notFound('Home', homeId));
        return reply.code(201).send(layout);
      },
    );

    app.get(
      '/layouts/:id',
      { schema: { params: LayoutParams, response: { 200: Layout, 404: ApiError } } },
      async (request, reply) => {
        const layout = await store.get(request.params.id);
        return layout ?? reply.code(404).send(notFound('Layout', request.params.id));
      },
    );

    app.put(
      '/layouts/:id',
      {
        schema: {
          params: LayoutParams,
          body: UpdateLayoutBody,
          response: { 200: Layout, 400: ApiError, 404: ApiError, 409: LayoutConflict },
        },
      },
      async (request, reply) => {
        const { id } = request.params;
        const result = await store.update(id, request.body);
        if (result.status === 'updated') return result.layout;
        if (result.status === 'not-found') return reply.code(404).send(notFound('Layout', id));
        return reply.code(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: `Layout "${id}" is at version ${result.currentVersion}, not ${request.body.version}`,
          currentVersion: result.currentVersion,
        });
      },
    );

    app.delete('/layouts/:id', { schema: { params: LayoutParams } }, async (request, reply) => {
      if (!(await store.remove(request.params.id))) {
        return reply.code(404).send(notFound('Layout', request.params.id));
      }
      return reply.code(204).send();
    });

    app.post(
      '/layouts/:id/duplicate',
      {
        schema: {
          params: LayoutParams,
          body: DuplicateLayoutBody,
          response: { 201: Layout, 400: ApiError, 404: ApiError },
        },
      },
      async (request, reply) => {
        const layout = await store.duplicate(request.params.id, request.body?.name);
        if (!layout) return reply.code(404).send(notFound('Layout', request.params.id));
        return reply.code(201).send(layout);
      },
    );

    // The layout as a downloadable, pretty-printed file that `import` accepts unchanged.
    app.get('/layouts/:id/export', { schema: { params: LayoutParams } }, async (request, reply) => {
      const layout = await store.get(request.params.id);
      if (!layout) return reply.code(404).send(notFound('Layout', request.params.id));
      const file: LayoutFile = {
        schemaVersion: layout.schemaVersion,
        name: layout.name,
        homeId: layout.homeId,
        items: layout.items,
      };
      return reply
        .type('application/json; charset=utf-8')
        .header('content-disposition', `attachment; filename="${fileName(layout.name)}"`)
        .send(`${JSON.stringify(file, null, 2)}\n`);
    });
  };
