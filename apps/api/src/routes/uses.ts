import {
  ApiError,
  HistoryEntryParams,
  ListHistoryResponse,
  ListUsesQuery,
  ListUsesResponse,
  UndoHomeSettingsResponse,
  UndoResponse,
  UseConflict,
  UseHomeParams,
  UseParams,
  WhoAmIResponse,
} from '@my-home/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { resolveActor } from '../actor';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { useStore } from '../db/uses';

/** Who am I (the recorded actor), where-used, and the history of a use with its undo. */
export const useRoutes =
  (
    db: Db,
    config: Pick<Config, 'agentUsernames' | 'userdataTrashRetentionDays'>,
  ): FastifyPluginAsyncZod =>
  async (app) => {
    const store = useStore(db, { retentionDays: config.userdataTrashRetentionDays });

    app.get('/whoami', { schema: { response: { 200: WhoAmIResponse } } }, (request) => {
      const { actor, source, username } = resolveActor(request.headers, config);
      return { username, actor, actorSource: source };
    });

    app.get(
      '/homes/:homeId/uses',
      {
        schema: {
          params: UseHomeParams,
          querystring: ListUsesQuery,
          response: { 200: ListUsesResponse, 400: ApiError, 404: ApiError },
        },
      },
      async (request) => ({ items: await store.list(request.params.homeId, request.query) }),
    );

    app.get(
      '/homes/:homeId/uses/:useId/history',
      {
        schema: {
          params: UseParams,
          response: { 200: ListHistoryResponse, 404: ApiError },
        },
      },
      async (request) => ({
        items: await store.history(request.params.homeId, request.params.useId),
      }),
    );

    app.post(
      '/homes/:homeId/uses/:useId/history/:entryId/undo',
      {
        schema: {
          params: HistoryEntryParams,
          response: {
            200: z.union([UndoResponse, UndoHomeSettingsResponse]),
            404: ApiError,
            409: UseConflict,
          },
        },
      },
      async (request) => {
        const { homeId, useId, entryId } = request.params;
        return store.undo(homeId, useId, entryId, resolveActor(request.headers, config));
      },
    );
  };
