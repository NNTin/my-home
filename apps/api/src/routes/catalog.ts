import { ApiError, catalog, CatalogUsageResponse, ListCatalogTypesResponse } from '@my-home/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { useStore } from '../db/uses';

/** The piece catalogue (shared definitions) and how often each type is used. */
export const catalogRoutes =
  (db: Db, config: Pick<Config, 'userdataTrashRetentionDays'>): FastifyPluginAsyncZod =>
  async (app) => {
    const uses = useStore(db, { retentionDays: config.userdataTrashRetentionDays });
    const items = catalog.types.map(({ openingTypes, ...type }) => ({
      ...type,
      ...(openingTypes && { openingTypes: [...openingTypes] }),
    }));

    app.get('/catalog/types', { schema: { response: { 200: ListCatalogTypesResponse } } }, () => ({
      items,
    }));

    app.get(
      '/catalog/usage',
      { schema: { response: { 200: CatalogUsageResponse, 500: ApiError } } },
      async () => ({ counts: await uses.usage() }),
    );
  };
