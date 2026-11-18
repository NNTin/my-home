import multipart from '@fastify/multipart';
import {
  ApiError,
  CreatePhotoMeta,
  CreatePhotoRequestBody,
  EmptyTrashResponse,
  formatIssues,
  FulfilPhotoRequestBody,
  ListPhotoRequestsQuery,
  ListPhotoRequestsResponse,
  ListPhotosQuery,
  ListPhotosResponse,
  Photo,
  PhotoHomeParams,
  PhotoParams,
  PhotoPoseChangeParams,
  PhotoPoseHistoryResponse,
  PhotoRequest,
  TrashResponse,
  UndoPhotoPoseResponse,
  UpdatePhotoBody,
} from '@my-home/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { resolveActor } from '../actor';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { photoStore, type PurgeResult } from '../db/photos';
import { processImage } from '../photos/image';

const error = (statusCode: number, name: string, message: string, extra: object = {}) => ({
  statusCode,
  error: name,
  message,
  ...extra,
});
const notFound = (kind: 'Photo' | 'Photo request', id: string) =>
  error(404, 'Not Found', `${kind} "${id}" not found`);
const badRequest = (message: string, extra: object = {}) =>
  error(400, 'Bad Request', message, extra);

/** Reads the `meta` (JSON) and `image` (file) parts of an upload. */
async function readUpload(request: FastifyRequest) {
  let meta: string | undefined;
  let image: Buffer | undefined;
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      // Every file part must be consumed; `toBuffer` fails with a 413 above the size limit.
      const data = await part.toBuffer();
      if (part.fieldname === 'image') image = data;
    } else if (part.fieldname === 'meta' && typeof part.value === 'string') {
      meta = part.value;
    }
  }
  return { meta, image };
}

/**
 * Photos with their pose, photo requests and the trash (docs/photos.md). Deleting moves an item
 * to the trash; only `purge` and `trash/empty` remove data, and those are the owner's actions.
 */
export const photoRoutes =
  (
    db: Db,
    config: Pick<Config, 'agentUsernames' | 'photoMaxUploadBytes' | 'photoTrashRetentionDays'>,
  ): FastifyPluginAsyncZod =>
  async (app) => {
    const store = photoStore(db, { retentionDays: config.photoTrashRetentionDays });
    await app.register(multipart, {
      limits: { fileSize: config.photoMaxUploadBytes, files: 1, fields: 4, fieldSize: 64 * 1024 },
    });

    const purged = (
      result: PurgeResult,
      kind: 'Photo' | 'Photo request',
      id: string,
      reply: FastifyReply,
    ) => {
      if (result === 'purged') return reply.code(204).send();
      if (result === 'not-found') return reply.code(404).send(notFound(kind, id));
      return reply
        .code(409)
        .send(error(409, 'Conflict', `${kind} "${id}" is not in the trash: delete it first`));
    };

    app.post(
      '/homes/:homeId/photos',
      {
        schema: {
          params: PhotoHomeParams,
          response: { 201: Photo, 400: ApiError, 409: ApiError, 413: ApiError, 415: ApiError },
        },
      },
      async (request, reply) => {
        if (!request.isMultipart()) {
          return reply
            .code(400)
            .send(
              badRequest('Send multipart/form-data with a "meta" JSON part and an "image" file'),
            );
        }
        const upload = await readUpload(request);
        if (!upload.image || upload.image.byteLength === 0) {
          return reply.code(400).send(badRequest('The "image" file part is missing'));
        }
        let json: unknown;
        try {
          json = JSON.parse(upload.meta ?? '');
        } catch {
          return reply.code(400).send(badRequest('The "meta" part is missing or not JSON'));
        }
        const meta = CreatePhotoMeta.safeParse(json);
        if (!meta.success) {
          const issues = formatIssues(meta.error);
          return reply.code(400).send(
            badRequest(`Invalid meta: ${issues[0]!.path || '(root)'}: ${issues[0]!.message}`, {
              issues,
            }),
          );
        }
        const processed = await processImage(upload.image);
        const photo = await store.create(request.params.homeId, meta.data, processed);
        if (!photo) {
          return reply
            .code(409)
            .send(error(409, 'Conflict', `Photo "${meta.data.id}" already exists`));
        }
        return reply.code(201).send(photo);
      },
    );

    app.get(
      '/homes/:homeId/photos',
      {
        schema: {
          params: PhotoHomeParams,
          querystring: ListPhotosQuery,
          response: { 200: ListPhotosResponse, 400: ApiError },
        },
      },
      (request) => store.list(request.params.homeId, request.query),
    );

    app.get(
      '/photos/:id',
      { schema: { params: PhotoParams, response: { 200: Photo, 404: ApiError } } },
      async (request, reply) =>
        (await store.get(request.params.id)) ??
        reply.code(404).send(notFound('Photo', request.params.id)),
    );

    for (const kind of ['image', 'thumbnail'] as const) {
      app.get(
        `/photos/:id/${kind}`,
        { schema: { params: PhotoParams } },
        async (request, reply) => {
          const image = await store.image(request.params.id, kind);
          if (!image) return reply.code(404).send(notFound('Photo', request.params.id));
          const etag = `"${image.sha256}-${kind}"`;
          // The bytes of a photo never change, and the site is private (behind SSO).
          reply
            .header('cache-control', 'private, max-age=31536000, immutable')
            .header('etag', etag);
          if (request.headers['if-none-match'] === etag) return reply.code(304).send();
          return reply.type(image.contentType).send(image.data);
        },
      );
    }

    app.patch(
      '/photos/:id',
      {
        schema: {
          params: PhotoParams,
          body: UpdatePhotoBody,
          response: { 200: Photo, 400: ApiError, 404: ApiError },
        },
      },
      async (request, reply) =>
        (await store.update(
          request.params.id,
          request.body,
          resolveActor(request.headers, config),
        )) ?? reply.code(404).send(notFound('Photo', request.params.id)),
    );

    // Pose corrections (docs/photos.md § Correcting a pose): the history and its undo.
    app.get(
      '/photos/:id/pose-history',
      {
        schema: { params: PhotoParams, response: { 200: PhotoPoseHistoryResponse, 404: ApiError } },
      },
      async (request, reply) => {
        const items = await store.poseHistory(request.params.id);
        return items ? { items } : reply.code(404).send(notFound('Photo', request.params.id));
      },
    );

    app.post(
      '/photos/:id/pose-history/:changeId/undo',
      {
        schema: {
          params: PhotoPoseChangeParams,
          response: { 200: UndoPhotoPoseResponse, 404: ApiError, 409: ApiError },
        },
      },
      async (request, reply) => {
        const { id, changeId } = request.params;
        const result = await store.undoPose(id, changeId, resolveActor(request.headers, config));
        if (result.status === 'undone') return { change: result.change, photo: result.photo };
        if (result.status === 'not-found') {
          return reply
            .code(404)
            .send(error(404, 'Not Found', `Pose change "${changeId}" of photo "${id}" not found`));
        }
        return reply
          .code(409)
          .send(
            error(
              409,
              'Conflict',
              result.status === 'already-undone'
                ? 'This change was undone already'
                : 'The pose has changed since: undo the later change first',
            ),
          );
      },
    );

    // Soft delete: the photo moves to the trash and can be restored until it is purged.
    app.delete(
      '/photos/:id',
      { schema: { params: PhotoParams, response: { 200: Photo, 404: ApiError } } },
      async (request, reply) =>
        (await store.softDelete(request.params.id)) ??
        reply.code(404).send(notFound('Photo', request.params.id)),
    );

    app.post(
      '/photos/:id/restore',
      { schema: { params: PhotoParams, response: { 200: Photo, 404: ApiError } } },
      async (request, reply) =>
        (await store.restore(request.params.id)) ??
        reply.code(404).send(notFound('Photo', request.params.id)),
    );

    app.post('/photos/:id/purge', { schema: { params: PhotoParams } }, async (request, reply) =>
      purged(await store.purge(request.params.id), 'Photo', request.params.id, reply),
    );

    app.post(
      '/homes/:homeId/photo-requests',
      {
        schema: {
          params: PhotoHomeParams,
          body: CreatePhotoRequestBody,
          response: { 201: PhotoRequest, 400: ApiError },
        },
      },
      async (request, reply) =>
        reply
          .code(201)
          .send(
            await store.createRequest(
              request.params.homeId,
              request.body,
              resolveActor(request.headers, config),
            ),
          ),
    );

    app.get(
      '/homes/:homeId/photo-requests',
      {
        schema: {
          params: PhotoHomeParams,
          querystring: ListPhotoRequestsQuery,
          response: { 200: ListPhotoRequestsResponse, 400: ApiError },
        },
      },
      async (request) => ({
        items: await store.listRequests(request.params.homeId, request.query.status),
      }),
    );

    app.get(
      '/photo-requests/:id',
      { schema: { params: PhotoParams, response: { 200: PhotoRequest, 404: ApiError } } },
      async (request, reply) =>
        (await store.getRequest(request.params.id)) ??
        reply.code(404).send(notFound('Photo request', request.params.id)),
    );

    app.post(
      '/photo-requests/:id/fulfil',
      {
        schema: {
          params: PhotoParams,
          body: FulfilPhotoRequestBody,
          response: { 200: PhotoRequest, 400: ApiError, 404: ApiError },
        },
      },
      async (request, reply) => {
        const result = await store.fulfilRequest(request.params.id, request.body.photoId);
        if (result.status === 'fulfilled') return result.request;
        if (result.status === 'not-found') {
          return reply.code(404).send(notFound('Photo request', request.params.id));
        }
        return reply
          .code(400)
          .send(
            badRequest(`Photo "${request.body.photoId}" is not a photo of this request's home`),
          );
      },
    );

    const requestActions = {
      cancel: store.cancelRequest,
      reopen: store.reopenRequest,
      restore: store.restoreRequest,
    };
    for (const [action, run] of Object.entries(requestActions)) {
      app.post(
        `/photo-requests/:id/${action}`,
        { schema: { params: PhotoParams, response: { 200: PhotoRequest, 404: ApiError } } },
        async (request, reply) =>
          (await run(request.params.id)) ??
          reply.code(404).send(notFound('Photo request', request.params.id)),
      );
    }

    app.delete(
      '/photo-requests/:id',
      { schema: { params: PhotoParams, response: { 200: PhotoRequest, 404: ApiError } } },
      async (request, reply) =>
        (await store.softDeleteRequest(request.params.id)) ??
        reply.code(404).send(notFound('Photo request', request.params.id)),
    );

    app.post(
      '/photo-requests/:id/purge',
      { schema: { params: PhotoParams } },
      async (request, reply) =>
        purged(
          await store.purgeRequest(request.params.id),
          'Photo request',
          request.params.id,
          reply,
        ),
    );

    // Listing the trash also applies the retention period, so it never shows expired items.
    app.get(
      '/homes/:homeId/trash',
      { schema: { params: PhotoHomeParams, response: { 200: TrashResponse } } },
      async (request) => {
        await store.purgeExpired();
        return store.trash(request.params.homeId);
      },
    );

    app.post(
      '/homes/:homeId/trash/empty',
      { schema: { params: PhotoHomeParams, response: { 200: EmptyTrashResponse } } },
      (request) => store.emptyTrash(request.params.homeId),
    );
  };
