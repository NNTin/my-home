import { ListHomesQuery, ListHomesResponse, type Home } from '@my-home/shared';
import { asc } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Db } from '../db/client';
import { homes, type HomeRow } from '../db/schema';

const toHome = (row: HomeRow): Home => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const homeRoutes =
  (db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/homes',
      { schema: { querystring: ListHomesQuery, response: { 200: ListHomesResponse } } },
      async (request) => {
        const rows = await db
          .select()
          .from(homes)
          .orderBy(asc(homes.createdAt), asc(homes.id))
          .limit(request.query.limit);
        return { items: rows.map(toHome) };
      },
    );
  };
