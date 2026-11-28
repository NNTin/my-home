import {
  ApiError,
  CreateNoteBody,
  ListNotesQuery,
  ListNotesResponse,
  Note,
  NoteParams,
  UpdateNoteBody,
} from '@my-home/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { resolveActor } from '../core/actor';
import type { Config } from '../core/config';
import type { Db } from '../db/types';
import { noteStore } from '../db/notes';

/** Notes on catalogue types and on uses (docs/userdata.md § Notes); the actor is recorded. */
export const noteRoutes =
  (db: Db, config: Pick<Config, 'agentUsernames'>): FastifyPluginAsyncZod =>
  async (app) => {
    const store = noteStore(db);

    app.get(
      '/notes',
      {
        schema: {
          querystring: ListNotesQuery,
          response: { 200: ListNotesResponse, 400: ApiError },
        },
      },
      async (request) => ({
        items: await store.list(request.query.subject, request.query.homeId),
      }),
    );

    app.post(
      '/notes',
      {
        schema: {
          body: CreateNoteBody,
          response: { 201: Note, 400: ApiError, 404: ApiError },
        },
      },
      async (request, reply) =>
        reply
          .code(201)
          .send(await store.create(request.body, resolveActor(request.headers, config))),
    );

    app.patch(
      '/notes/:id',
      {
        schema: {
          params: NoteParams,
          body: UpdateNoteBody,
          response: { 200: Note, 400: ApiError, 404: ApiError },
        },
      },
      (request) =>
        store.update(request.params.id, request.body, resolveActor(request.headers, config)),
    );

    app.delete(
      '/notes/:id',
      { schema: { params: NoteParams, response: { 204: z.null(), 404: ApiError } } },
      async (request, reply) => {
        await store.remove(request.params.id, resolveActor(request.headers, config));
        return reply.code(204).send(null);
      },
    );
  };
