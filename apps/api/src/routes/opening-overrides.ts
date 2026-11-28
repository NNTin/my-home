import {
  ApiError,
  ListOpeningOverridesResponse,
  OpeningOverride,
  PutOpeningOverrideBody,
  UseConflict,
  UseHomeParams,
  UseParams,
} from '@my-home/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { resolveActor } from '../core/actor';
import type { Config } from '../core/config';
import type { Db } from '../db/types';
import { openingOverrideStore } from '../db/opening-overrides';

/** Basic-parameter overrides of the openings, roof windows and gates that live in git. */
export const openingOverrideRoutes =
  (db: Db, config: Pick<Config, 'agentUsernames'>): FastifyPluginAsyncZod =>
  async (app) => {
    const store = openingOverrideStore(db);

    app.get(
      '/homes/:homeId/opening-overrides',
      {
        schema: {
          params: UseHomeParams,
          response: { 200: ListOpeningOverridesResponse, 404: ApiError },
        },
      },
      async (request) => ({ items: await store.list(request.params.homeId) }),
    );

    app.put(
      '/homes/:homeId/opening-overrides/:useId',
      {
        schema: {
          params: UseParams,
          body: PutOpeningOverrideBody,
          response: {
            200: OpeningOverride,
            400: ApiError,
            404: ApiError,
            409: UseConflict,
            422: ApiError,
          },
        },
      },
      async (request) => {
        const { homeId, useId } = request.params;
        return store.put(homeId, useId, request.body, resolveActor(request.headers, config));
      },
    );
  };
