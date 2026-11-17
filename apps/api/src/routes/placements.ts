import {
  ApiError,
  CreatePlacementBody,
  ListPlacementsQuery,
  ListPlacementsResponse,
  Placement,
  PlacementParams,
  RemovePlacementQuery,
  UpdatePlacementBody,
  UseConflict,
  UseHomeParams,
} from '@my-home/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { resolveActor } from '../actor';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { placementStore } from '../db/placements';

/**
 * Furniture placements (one set per home). The server assigns ids and names and derives the room
 * from the position; every change is recorded in the use's history with its actor.
 */
export const placementRoutes =
  (
    db: Db,
    config: Pick<Config, 'agentUsernames' | 'userdataTrashRetentionDays'>,
  ): FastifyPluginAsyncZod =>
  async (app) => {
    const store = placementStore(db, { retentionDays: config.userdataTrashRetentionDays });

    app.get(
      '/homes/:homeId/placements',
      {
        schema: {
          params: UseHomeParams,
          querystring: ListPlacementsQuery,
          response: { 200: ListPlacementsResponse, 400: ApiError, 404: ApiError },
        },
      },
      async (request) => ({
        items: await store.list(request.params.homeId, request.query.include === 'removed'),
      }),
    );

    app.post(
      '/homes/:homeId/placements',
      {
        schema: {
          params: UseHomeParams,
          body: CreatePlacementBody,
          response: { 201: Placement, 400: ApiError, 404: ApiError },
        },
      },
      async (request, reply) => {
        // A sent roomId is ignored: the store derives the room from the position.
        const placement = await store.create(
          request.params.homeId,
          request.body,
          resolveActor(request.headers, config),
        );
        return reply.code(201).send(placement);
      },
    );

    app.patch(
      '/homes/:homeId/placements/:id',
      {
        schema: {
          params: PlacementParams,
          body: UpdatePlacementBody,
          response: {
            200: Placement,
            400: ApiError,
            404: ApiError,
            409: UseConflict,
            422: ApiError,
          },
        },
      },
      async (request) => {
        const { homeId, id } = request.params;
        return store.update(homeId, id, request.body, resolveActor(request.headers, config));
      },
    );

    // Soft: the placement moves to the trash and is purged after the retention period.
    app.delete(
      '/homes/:homeId/placements/:id',
      {
        schema: {
          params: PlacementParams,
          querystring: RemovePlacementQuery,
          response: { 200: Placement, 400: ApiError, 404: ApiError, 409: UseConflict },
        },
      },
      async (request) => {
        const { homeId, id } = request.params;
        const actor = resolveActor(request.headers, config);
        return store.setRemoved(homeId, id, true, actor, request.query.version);
      },
    );

    app.post(
      '/homes/:homeId/placements/:id/restore',
      {
        schema: {
          params: PlacementParams,
          response: { 200: Placement, 404: ApiError, 409: UseConflict },
        },
      },
      async (request) => {
        const { homeId, id } = request.params;
        return store.setRemoved(homeId, id, false, resolveActor(request.headers, config));
      },
    );
  };
