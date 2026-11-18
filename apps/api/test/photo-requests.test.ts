import {
  ListPhotoRequestsResponse,
  Photo,
  PhotoRequest,
  TrashResponse,
  type CreatePhotoRequestBody,
} from '@my-home/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { homes } from '../src/db/schema';
import { seed } from '../src/db/seed';
import { clearMedia, createTestApp, testImage, uploadPayload } from './helpers';

const body = (overrides: Partial<CreatePhotoRequestBody> = {}): CreatePhotoRequestBody => ({
  levelId: 'souterrain',
  position: { x: 3, z: -2 },
  yaw: 1.5,
  pitch: 0,
  reason: 'How wide is the window above the sink?',
  requester: 'agent',
  ...overrides,
});

describe('photo requests API', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeEach(async () => {
    if (ctx) await ctx.database.db.delete(homes);
    else ctx = await createTestApp();
    await clearMedia(ctx);
    await seed(ctx.database.db);
  });
  afterAll(() => ctx.app.close());

  const inject = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) =>
    ctx.app.inject({ method, url, ...(payload !== undefined && { payload: payload as object }) });

  const create = async (overrides: Partial<CreatePhotoRequestBody> = {}, home = 'mock-home') => {
    const res = await inject('POST', `/api/homes/${home}/photo-requests`, body(overrides));
    expect(res.statusCode, res.body).toBe(201);
    return PhotoRequest.parse(res.json());
  };
  const get = async (id: string) =>
    PhotoRequest.parse((await inject('GET', `/api/photo-requests/${id}`)).json());
  const list = async (query = '') =>
    ListPhotoRequestsResponse.parse(
      (await inject('GET', `/api/homes/mock-home/photo-requests${query}`)).json(),
    ).items.map((r) => r.id);

  const upload = async (requestId?: string, home = 'mock-home') => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/homes/${home}/photos`,
      ...(await uploadPayload(
        {
          levelId: 'souterrain',
          pose: { position: { x: 3, y: -1, z: -2 }, yaw: 1.5, pitch: 0 },
          ...(requestId && { requestId }),
        },
        await testImage(),
      )),
    });
    expect(res.statusCode, res.body).toBe(201);
    return Photo.parse(res.json());
  };

  it('creates a request and fills in the room from the position, or the level from the room', async () => {
    const atPosition = await create();
    expect(atPosition).toMatchObject({
      homeId: 'mock-home',
      levelId: 'souterrain',
      roomId: 'souterrain-kitchen',
      roomName: 'Kitchen',
      position: { x: 3, z: -2 },
      yaw: 1.5,
      pitch: 0,
      reason: 'How wide is the window above the sink?',
      requester: 'agent',
      status: 'open',
      photoIds: [],
      closedAt: null,
      deletedAt: null,
    });

    const roomOnly = await create({
      levelId: undefined,
      position: undefined,
      yaw: undefined,
      pitch: undefined,
      roomId: 'souterrain-bedroom',
      requester: 'owner',
    });
    expect(roomOnly).toMatchObject({
      levelId: 'souterrain',
      roomId: 'souterrain-bedroom',
      roomName: 'Bedroom',
      position: null,
      yaw: null,
      requester: 'owner',
    });
    expect(await get(roomOnly.id)).toEqual(roomOnly);
  });

  it('validates the body', async () => {
    const invalid = [
      body({ reason: '  ' }),
      body({ requester: 'someone' as 'agent' }),
      body({ position: undefined }),
      body({ pitch: 3 }),
      { ...body(), extra: true },
    ];
    for (const payload of invalid) {
      const res = await inject('POST', '/api/homes/mock-home/photo-requests', payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect((await inject('GET', '/api/photo-requests/nope')).statusCode).toBe(404);
  });

  it('is fulfilled by a photo uploaded for it', async () => {
    const request = await create();
    const other = await create({ reason: 'Another one' });
    const photo = await upload(request.id);
    expect(photo.requestId).toBe(request.id);

    const fulfilled = await get(request.id);
    expect(fulfilled).toMatchObject({ status: 'fulfilled', photoIds: [photo.id] });
    expect(fulfilled.closedAt).not.toBeNull();
    expect(await get(other.id)).toMatchObject({ status: 'open', photoIds: [] });

    expect(await list()).toEqual([other.id]);
    expect(await list('?status=open')).toEqual([other.id]);
    expect(await list('?status=fulfilled')).toEqual([request.id]);
    expect(await list('?status=all')).toEqual([request.id, other.id]);
    expect((await inject('GET', '/api/homes/mock-home/photo-requests?status=x')).statusCode).toBe(
      400,
    );
  });

  it('is fulfilled by linking an existing photo of the same home', async () => {
    const request = await create();
    const photo = await upload();
    const foreign = await upload(undefined, 'another-home');

    const url = `/api/photo-requests/${request.id}/fulfil`;
    expect((await inject('POST', url, { photoId: foreign.id })).statusCode).toBe(400);
    expect((await inject('POST', url, { photoId: 'nope' })).statusCode).toBe(400);
    expect(
      (await inject('POST', '/api/photo-requests/nope/fulfil', { photoId: photo.id })).statusCode,
    ).toBe(404);
    expect(await get(request.id)).toMatchObject({ status: 'open' });

    const res = await inject('POST', url, { photoId: photo.id });
    expect(PhotoRequest.parse(res.json())).toMatchObject({
      status: 'fulfilled',
      photoIds: [photo.id],
    });
    expect((await inject('GET', `/api/photos/${photo.id}`)).json().requestId).toBe(request.id);

    // A photo in the trash no longer counts as an answer.
    await inject('DELETE', `/api/photos/${photo.id}`);
    expect((await get(request.id)).photoIds).toEqual([]);
  });

  it('is fulfilled by setting the request on an existing photo', async () => {
    const request = await create();
    const photo = await upload();
    const patch = (requestId: string | null) =>
      ctx.app.inject({ method: 'PATCH', url: `/api/photos/${photo.id}`, payload: { requestId } });

    expect((await patch(request.id)).json().requestId).toBe(request.id);
    const fulfilled = await get(request.id);
    expect(fulfilled).toMatchObject({ status: 'fulfilled', photoIds: [photo.id] });
    expect(fulfilled.closedAt).not.toBeNull();

    // Unlinking leaves the request closed; only the owner reopens it.
    await patch(null);
    expect(await get(request.id)).toMatchObject({ status: 'fulfilled', photoIds: [] });
    // A cancelled request stays cancelled when a photo is linked to it.
    const cancelled = await create({ reason: 'No longer needed' });
    await inject('POST', `/api/photo-requests/${cancelled.id}/cancel`);
    await patch(cancelled.id);
    expect(await get(cancelled.id)).toMatchObject({ status: 'cancelled', photoIds: [photo.id] });
  });

  it('never counts a photo of another home as an answer', async () => {
    const request = await create();
    // Request ids on photos are soft references: another home's photo may carry this id.
    const foreign = await upload(request.id, 'another-home');
    expect(foreign.requestId).toBe(request.id);
    expect(await get(request.id)).toMatchObject({ status: 'open', photoIds: [] });

    const moved = await upload(undefined, 'another-home');
    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/photos/${moved.id}`,
      payload: { requestId: request.id },
    });
    expect(patched.statusCode).toBe(200);
    expect(await get(request.id)).toMatchObject({ status: 'open', photoIds: [] });

    // A photo of the request's own home still counts, next to the foreign ones.
    const own = await upload(request.id);
    expect(await get(request.id)).toMatchObject({ status: 'fulfilled', photoIds: [own.id] });
    const listed = ListPhotoRequestsResponse.parse(
      (await inject('GET', '/api/homes/mock-home/photo-requests?status=all')).json(),
    ).items;
    expect(listed.map((r) => r.photoIds)).toEqual([[own.id]]);
  });

  it('can be cancelled and reopened', async () => {
    const request = await create();
    const cancelled = PhotoRequest.parse(
      (await inject('POST', `/api/photo-requests/${request.id}/cancel`)).json(),
    );
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.closedAt).not.toBeNull();
    expect(await list()).toEqual([]);
    expect(await list('?status=cancelled')).toEqual([request.id]);

    // A photo for a closed request is stored but does not change its status.
    await upload(request.id);
    expect((await get(request.id)).status).toBe('cancelled');

    const reopened = PhotoRequest.parse(
      (await inject('POST', `/api/photo-requests/${request.id}/reopen`)).json(),
    );
    expect(reopened).toMatchObject({ status: 'open', closedAt: null });
    expect((await inject('POST', '/api/photo-requests/nope/cancel')).statusCode).toBe(404);
  });

  it('is deleted into the trash, restored and purged like a photo', async () => {
    const request = await create();
    expect((await inject('POST', `/api/photo-requests/${request.id}/purge`)).statusCode).toBe(409);

    const deleted = PhotoRequest.parse(
      (await inject('DELETE', `/api/photo-requests/${request.id}`)).json(),
    );
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.purgeAt).not.toBeNull();
    expect(await list('?status=all')).toEqual([]);
    const trash = TrashResponse.parse((await inject('GET', '/api/homes/mock-home/trash')).json());
    expect(trash.requests.map((r) => r.id)).toEqual([request.id]);

    await inject('POST', `/api/photo-requests/${request.id}/restore`);
    expect(await list()).toEqual([request.id]);

    await inject('DELETE', `/api/photo-requests/${request.id}`);
    expect((await inject('POST', `/api/photo-requests/${request.id}/purge`)).statusCode).toBe(204);
    expect((await inject('GET', `/api/photo-requests/${request.id}`)).statusCode).toBe(404);
    expect((await inject('DELETE', '/api/photo-requests/nope')).statusCode).toBe(404);
  });

  describe('subjects', () => {
    const kitchenWindow = { kind: 'use', id: 'souterrain-kitchen-window' } as const;

    it('stores the subject and resolves it on read', async () => {
      const request = await create({ subject: kitchenWindow });
      expect(request.subject).toEqual({
        ...kitchenWindow,
        name: expect.any(String),
        status: 'current',
      });
      expect((await get(request.id)).subject).toEqual(request.subject);
      expect((await create()).subject).toBeNull();
      const typed = await create({ subject: { kind: 'type', id: 'window.casement' } });
      expect(typed.subject).toMatchObject({ name: 'Casement window', status: 'current' });
    });

    it("a request with only a use subject is placed in the use's first room", async () => {
      const request = await create({
        levelId: undefined,
        position: undefined,
        yaw: undefined,
        pitch: undefined,
        subject: kitchenWindow,
      });
      expect(request).toMatchObject({
        roomId: 'souterrain-kitchen',
        roomName: 'Kitchen',
        levelId: 'souterrain',
        position: null,
      });
      const post = (payload: object) =>
        inject('POST', '/api/homes/mock-home/photo-requests', { reason: 'x', ...payload });
      // A type is no place, and an unknown use has no room.
      expect((await post({ subject: { kind: 'type', id: 'window.casement' } })).statusCode).toBe(
        400,
      );
      expect((await post({ subject: { kind: 'use', id: 'nope' } })).statusCode).toBe(400);
      expect((await post({})).statusCode).toBe(400);
    });

    it('records the actor as the requester when none is given, and keeps a given one', async () => {
      const declared = (actor: string) =>
        ctx.app.inject({
          method: 'POST',
          url: '/api/homes/mock-home/photo-requests',
          headers: { 'x-my-home-actor': actor },
          payload: { roomId: 'souterrain-kitchen', reason: 'x' },
        });
      expect(PhotoRequest.parse((await declared('agent')).json()).requester).toBe('agent');
      expect(PhotoRequest.parse((await declared('owner')).json()).requester).toBe('owner');
      const sso = await ctx.app.inject({
        method: 'POST',
        url: '/api/homes/mock-home/photo-requests',
        headers: { 'x-authentik-username': 'nntin-bot' },
        payload: { roomId: 'souterrain-kitchen', reason: 'x' },
      });
      expect(PhotoRequest.parse(sso.json()).requester).toBe('agent');
      expect((await create({ requester: 'owner' })).requester).toBe('owner');
    });

    it('a photo answering a request with a subject is linked to it', async () => {
      const uploaded = await create({ subject: kitchenWindow });
      const photo = await upload(uploaded.id);
      expect(photo.subjects.map((s) => s.id)).toEqual([kitchenWindow.id]);

      const fulfilled = await create({ subject: { kind: 'type', id: 'window.casement' } });
      const other = await upload();
      expect(other.subjects).toEqual([]);
      const res = await inject('POST', `/api/photo-requests/${fulfilled.id}/fulfil`, {
        photoId: other.id,
      });
      expect(res.statusCode, res.body).toBe(200);
      const linked = Photo.parse((await inject('GET', `/api/photos/${other.id}`)).json());
      expect(linked.subjects.map((s) => s.id)).toEqual(['window.casement']);

      // Linking through PATCH does the same, and a request without a subject adds nothing.
      const plain = await create();
      const third = await upload();
      await ctx.app.inject({
        method: 'PATCH',
        url: `/api/photos/${third.id}`,
        payload: { requestId: plain.id },
      });
      expect(Photo.parse((await inject('GET', `/api/photos/${third.id}`)).json()).subjects).toEqual(
        [],
      );
      await ctx.app.inject({
        method: 'PATCH',
        url: `/api/photos/${third.id}`,
        payload: { requestId: uploaded.id },
      });
      expect(
        Photo.parse((await inject('GET', `/api/photos/${third.id}`)).json()).subjects.map(
          (s) => s.id,
        ),
      ).toEqual([kitchenWindow.id]);
    });
  });
});
