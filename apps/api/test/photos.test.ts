import {
  ApiError,
  ListPhotosResponse,
  Photo,
  PhotoRequest,
  TrashResponse,
  type CreatePhotoMeta,
  type HomeModel,
} from '@my-home/shared';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { homeStore } from '../src/db/homes';
import { photos, photoSubjects } from '../src/db/media-schema';
import { photoStore } from '../src/db/photos';
import { homes } from '../src/db/schema';
import { seed } from '../src/db/seed';
import { clearMedia, createTestApp, testImage, uploadPayload } from './helpers';

// Mock home, level `souterrain`: the bedroom is x -5…-0.5, z 1…4; the kitchen x 1.5…5, z -4…0.5.
const inBedroom = { x: -3, y: -1, z: 2.5 };
const inKitchen = { x: 3, y: -1, z: -2 };
const meta = (overrides: Partial<CreatePhotoMeta> = {}): CreatePhotoMeta => ({
  levelId: 'souterrain',
  pose: { position: inBedroom, yaw: 0.5, pitch: -0.1, fovH: 1.2 },
  ...overrides,
});

describe('photos API', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let image: Buffer;
  beforeEach(async () => {
    if (ctx) await ctx.database.db.delete(homes);
    else ctx = await createTestApp({ PHOTO_MAX_UPLOAD_BYTES: '200000' });
    await clearMedia(ctx);
    await seed(ctx.database.db);
    image ??= await testImage();
  });
  afterAll(() => ctx.app.close());

  const inject = (
    method: 'GET' | 'PATCH' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    payload?: unknown,
  ) =>
    ctx.app.inject({ method, url, ...(payload !== undefined && { payload: payload as object }) });

  const post = async (data: unknown, file: Buffer | null = image, home = 'mock-home') =>
    ctx.app.inject({
      method: 'POST',
      url: `/api/homes/${home}/photos`,
      ...(await uploadPayload(data, file ?? undefined)),
    });

  const upload = async (overrides: Partial<CreatePhotoMeta> = {}, home = 'mock-home') => {
    const res = await post(meta(overrides), image, home);
    expect(res.statusCode, res.body).toBe(201);
    return Photo.parse(res.json());
  };

  const list = async (query = '', home = 'mock-home') => {
    const res = await inject('GET', `/api/homes/${home}/photos${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return ListPhotosResponse.parse(res.json());
  };
  const ids = async (query = '') => (await list(query)).items.map((p) => p.id);

  describe('upload', () => {
    it('stores the photo with its pose and derives the room from the model', async () => {
      const photo = await upload({ note: 'North wall', tags: ['Wall', ' window ', 'wall'] });
      expect(photo).toMatchObject({
        homeId: 'mock-home',
        levelId: 'souterrain',
        pose: { position: inBedroom, yaw: 0.5, pitch: -0.1, fovH: 1.2 },
        capturedRoomId: 'souterrain-bedroom',
        capturedRoomName: 'Bedroom',
        capturedRoomStatus: 'current',
        room: { id: 'souterrain-bedroom', name: 'Bedroom' },
        levelInModel: true,
        note: 'North wall',
        tags: ['wall', 'window'],
        requestId: null,
        image: { contentType: 'image/webp', width: 64, height: 48 },
        thumbnail: { contentType: 'image/webp', width: 64, height: 48 },
        deletedAt: null,
        purgeAt: null,
      });
      expect(Date.now() - Date.parse(photo.takenAt)).toBeLessThan(60_000);
      expect(Photo.parse((await inject('GET', `/api/photos/${photo.id}`)).json())).toEqual(photo);
    });

    it('serves the image and the thumbnail without any metadata', async () => {
      const withExif = await testImage({
        width: 800,
        height: 600,
        exif: { IFD0: { Make: 'TestCameraMaker' }, IFD3: { GPSLatitude: '1/1 2/1 3/1' } },
      });
      const res = await post(meta(), withExif);
      const photo = Photo.parse(res.json());
      for (const [kind, width] of [
        ['image', 800],
        ['thumbnail', 480],
      ] as const) {
        const file = await inject('GET', `/api/photos/${photo.id}/${kind}`);
        expect(file.statusCode).toBe(200);
        expect(file.headers['content-type']).toBe('image/webp');
        expect(file.headers['cache-control']).toContain('immutable');
        expect(file.rawPayload.byteLength).toBe(photo[kind].byteSize);
        const metadata = await sharp(file.rawPayload).metadata();
        expect(metadata.width).toBe(width);
        expect(metadata.exif).toBeUndefined();
        expect(file.rawPayload.includes('TestCameraMaker')).toBe(false);

        const cached = await ctx.app.inject({
          method: 'GET',
          url: `/api/photos/${photo.id}/${kind}`,
          headers: { 'if-none-match': file.headers.etag as string },
        });
        expect(cached.statusCode).toBe(304);
      }
      expect((await inject('GET', '/api/photos/nope/image')).statusCode).toBe(404);
    });

    it('keeps a given id, time and captured room (the copy tool) and refuses a duplicate id', async () => {
      const given = {
        id: '0b0e7a52-6f0c-4c58-9d0a-3d1c2b4a5e6f',
        takenAt: '2026-01-02T03:04:05.000Z',
        capturedRoomId: 'old-room',
        capturedRoomName: 'Old room',
      };
      const photo = await upload(given);
      expect(photo).toMatchObject({ ...given, capturedRoomStatus: 'missing' });
      const again = await post(meta(given));
      expect(again.statusCode).toBe(409);
      expect((await list()).total).toBe(1);
    });

    it('accepts photos outdoors, without a level, and for a home that is not stored here', async () => {
      const outdoors = await upload({ levelId: null, pose: meta().pose });
      expect(outdoors).toMatchObject({
        levelId: null,
        capturedRoomId: null,
        capturedRoomStatus: 'none',
        room: null,
        levelInModel: false,
      });
      const elsewhere = await upload({}, 'another-home');
      expect(elsewhere).toMatchObject({ homeId: 'another-home', capturedRoomId: null, room: null });
      expect((await list('', 'another-home')).items.map((p) => p.id)).toEqual([elsewhere.id]);
    });

    it('rejects bad uploads with a clear error', async () => {
      const cases: [string, Awaited<ReturnType<typeof post>>, number, RegExp][] = [
        ['no image', await post(meta(), null), 400, /"image" file part is missing/],
        ['no meta', await post(undefined), 400, /"meta" part is missing or not JSON/],
        ['meta not JSON', await post('{nope'), 400, /not JSON/],
        ['no pose', await post({ levelId: 'souterrain' }), 400, /Invalid meta: pose/],
        [
          'pitch out of range',
          await post(meta({ pose: { position: inBedroom, yaw: 0, pitch: 2 } })),
          400,
          /pose\.pitch/,
        ],
        ['unknown key', await post({ ...meta(), gps: [1, 2] }), 400, /Invalid meta/],
        ['not an image', await post(meta(), Buffer.from('plain text')), 415, /not an image/],
        ['a GIF', await post(meta(), await testImage({ format: 'gif' })), 415, /JPEG, PNG or WebP/],
        ['too large', await post(meta(), Buffer.alloc(200_001, 1)), 413, /too large/i],
      ];
      for (const [name, res, status, message] of cases) {
        expect(res.statusCode, name).toBe(status);
        expect(ApiError.parse(res.json()).message, name).toMatch(message);
      }
      const json = await inject('POST', '/api/homes/mock-home/photos', meta());
      expect(json.statusCode).toBe(400);
      expect(json.json().message).toMatch(/multipart/);
      expect((await list()).total).toBe(0);
    });
  });

  describe('sensor snapshot', () => {
    // Orientation only, made-up values: what a phone reports when a photo is taken.
    const sensors = {
      source: 'sensor' as const,
      alpha: 271.5,
      beta: 84,
      gamma: -2,
      absolute: true,
      screenAngle: 0,
      magneticBearing: 88.5,
      declination: 3,
      calibrationOffset: -7,
      trueBearing: 84.5,
      yaw: -1.5,
      pitch: -0.1,
      roll: 0.02,
      capturedAt: '2026-03-01T10:00:00.000Z',
    };

    it('is stored with the photo and returned by get and list', async () => {
      const photo = await upload({ sensors });
      expect(photo.sensors).toEqual(sensors);
      expect(Photo.parse((await inject('GET', `/api/photos/${photo.id}`)).json()).sensors).toEqual(
        sensors,
      );
      expect((await list()).items[0]!.sensors).toEqual(sensors);

      const ios = await upload({
        sensors: { source: 'sensor', compassHeading: 120, compassAccuracy: 15, beta: 80, gamma: 1 },
      });
      expect(ios.sensors).toMatchObject({ compassHeading: 120, compassAccuracy: 15 });
      const manual = await upload({ sensors: { source: 'manual', yaw: 0.5, pitch: 0 } });
      expect(manual.sensors).toEqual({ source: 'manual', yaw: 0.5, pitch: 0 });
    });

    it('is optional: clients that send none still work, and the photo has null', async () => {
      const photo = await upload();
      expect(photo.sensors).toBeNull();
      expect((await upload({ sensors: null })).sensors).toBeNull();
    });

    it('survives a correction of the pose, and can be set or cleared on its own', async () => {
      const photo = await upload({ sensors });
      const pose = { position: inKitchen, yaw: 1, pitch: 0.2 };
      const moved = Photo.parse(
        (await inject('PATCH', `/api/photos/${photo.id}`, { pose })).json(),
      );
      expect(moved.pose).toEqual(pose);
      // What the sensors said at the shot stays, next to the corrected pose.
      expect(moved.sensors).toEqual(sensors);

      const manual = { source: 'manual' as const, yaw: 1, pitch: 0.2 };
      const set = await inject('PATCH', `/api/photos/${photo.id}`, { sensors: manual });
      expect(Photo.parse(set.json()).sensors).toEqual(manual);
      const cleared = await inject('PATCH', `/api/photos/${photo.id}`, { sensors: null });
      expect(Photo.parse(cleared.json()).sensors).toBeNull();
    });

    it('rejects a malformed snapshot and drops keys it does not know', async () => {
      const bad = await post(meta({ sensors: { source: 'gps' } as never }));
      expect(bad.statusCode).toBe(400);
      expect(bad.json().message).toMatch(/sensors/);
      const extra = await upload({
        sensors: { source: 'sensor', alpha: 1, latitude: 1, longitude: 2 } as never,
      });
      expect(extra.sensors).toEqual({ source: 'sensor', alpha: 1 });
    });

    it('reads a photo whose stored snapshot it cannot understand as having none', async () => {
      const photo = await upload({ sensors });
      await ctx.database.db
        .update(photos)
        .set({ sensors: { source: 'from-a-newer-branch' } as never })
        .where(eq(photos.id, photo.id));
      const res = await inject('GET', `/api/photos/${photo.id}`);
      expect(res.statusCode).toBe(200);
      expect(Photo.parse(res.json()).sensors).toBeNull();
    });
  });

  describe('list filters', () => {
    it('filters by level, room, tag, request, place and date, newest first, with paging', async () => {
      const bedroom = await upload({ takenAt: '2026-03-01T10:00:00Z', tags: ['wall'] });
      const kitchen = await upload({
        takenAt: '2026-03-02T10:00:00Z',
        pose: { position: inKitchen, yaw: 0, pitch: 0 },
        tags: ['window', 'wall'],
        requestId: 'request-1',
      });
      const upstairs = await upload({
        takenAt: '2026-03-03T10:00:00Z',
        levelId: 'ground-floor',
        pose: { position: { x: 3, y: 1.6, z: -2 }, yaw: 0, pitch: 0 },
      });
      await upload({}, 'another-home');

      expect(await ids()).toEqual([upstairs.id, kitchen.id, bedroom.id]);
      expect(await ids('?levelId=souterrain')).toEqual([kitchen.id, bedroom.id]);
      expect(await ids('?roomId=souterrain-kitchen')).toEqual([kitchen.id]);
      expect(await ids('?tag=wall')).toEqual([kitchen.id, bedroom.id]);
      expect(await ids('?tag=WINDOW')).toEqual([kitchen.id]);
      expect(await ids('?requestId=request-1')).toEqual([kitchen.id]);
      expect(await ids('?near=3,-2,0.5')).toEqual([upstairs.id, kitchen.id]);
      expect(await ids('?near=3,-2,0.5&levelId=souterrain')).toEqual([kitchen.id]);
      expect(await ids('?near=-3,2,1.5')).toEqual([bedroom.id]);
      expect(await ids('?since=2026-03-02T00:00:00Z')).toEqual([upstairs.id, kitchen.id]);
      expect(await ids('?since=2026-03-02T00:00:00Z&until=2026-03-03T00:00:00Z')).toEqual([
        kitchen.id,
      ]);

      const page = await list('?limit=1&offset=1');
      expect(page.items.map((p) => p.id)).toEqual([kitchen.id]);
      expect(page.total).toBe(3);
      const roomPage = await list('?roomId=souterrain-bedroom&limit=1&offset=1');
      expect(roomPage).toMatchObject({ items: [], total: 1 });

      for (const bad of ['?near=1,2', '?limit=0', '?since=yesterday']) {
        expect((await inject('GET', `/api/homes/mock-home/photos${bad}`)).statusCode).toBe(400);
      }
    });
  });

  describe('update', () => {
    it('changes note and tags without touching the pose or the room', async () => {
      const photo = await upload();
      const res = await inject('PATCH', `/api/photos/${photo.id}`, {
        note: 'Socket on the left',
        tags: ['Furniture'],
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(Photo.parse(res.json())).toMatchObject({
        note: 'Socket on the left',
        tags: ['furniture'],
        pose: photo.pose,
        capturedRoomId: 'souterrain-bedroom',
      });
    });

    it('re-derives the room when the pose is adjusted', async () => {
      const photo = await upload();
      const pose = { position: inKitchen, yaw: 1, pitch: 0.2 };
      const moved = Photo.parse(
        (await inject('PATCH', `/api/photos/${photo.id}`, { pose })).json(),
      );
      expect(moved).toMatchObject({
        pose,
        capturedRoomId: 'souterrain-kitchen',
        capturedRoomName: 'Kitchen',
        room: { id: 'souterrain-kitchen' },
      });
      const lifted = Photo.parse(
        (await inject('PATCH', `/api/photos/${photo.id}`, { levelId: 'first-floor' })).json(),
      );
      expect(lifted).toMatchObject({ levelId: 'first-floor', pose, capturedRoomId: null });
    });

    it('answers 404 for an unknown photo and 400 for an invalid body', async () => {
      expect((await inject('PATCH', '/api/photos/nope', { note: 'x' })).statusCode).toBe(404);
      const photo = await upload();
      const res = await inject('PATCH', `/api/photos/${photo.id}`, { homeId: 'other' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('soft references to rooms and levels', () => {
    const replaceModel = async (change: (model: HomeModel) => void) => {
      const model = (await homeStore(ctx.database.db).get('mock-home'))!;
      change(model);
      const res = await inject('PUT', '/api/homes/mock-home', model);
      expect(res.statusCode, res.body).toBe(200);
    };

    it('keeps the captured room when the room is renamed or removed', async () => {
      const photo = await upload();

      await replaceModel((model) => {
        model.rooms.find((r) => r.id === 'souterrain-bedroom')!.name = 'Guest room';
      });
      expect(Photo.parse((await inject('GET', `/api/photos/${photo.id}`)).json())).toMatchObject({
        capturedRoomId: 'souterrain-bedroom',
        capturedRoomName: 'Bedroom',
        capturedRoomStatus: 'renamed',
        room: { id: 'souterrain-bedroom', name: 'Guest room' },
      });

      // Another branch's model: the bedroom is gone and a new room covers its floor.
      await replaceModel((model) => {
        const bedroom = model.rooms.find((r) => r.id === 'souterrain-bedroom')!;
        bedroom.id = 'souterrain-study';
        bedroom.name = 'Study';
      });
      const listed = (await list()).items[0]!;
      expect(listed).toMatchObject({
        id: photo.id,
        pose: photo.pose,
        capturedRoomId: 'souterrain-bedroom',
        capturedRoomName: 'Bedroom',
        capturedRoomStatus: 'missing',
        room: { id: 'souterrain-study', name: 'Study' },
      });
      // Both the old and the new room id find the photo.
      expect(await ids('?roomId=souterrain-bedroom')).toEqual([photo.id]);
      expect(await ids('?roomId=souterrain-study')).toEqual([photo.id]);
    });

    it('still lists photos when the home is gone or its stored model is unreadable', async () => {
      const photo = await upload();
      await ctx.database.db
        .update(homes)
        .set({ model: { rooms: 'from another schema' } as unknown as HomeModel })
        .where(eq(homes.id, 'mock-home'));
      const unreadable = (await list()).items[0]!;
      expect(unreadable).toMatchObject({
        id: photo.id,
        capturedRoomName: 'Bedroom',
        capturedRoomStatus: 'missing',
        room: null,
        levelInModel: false,
      });

      await ctx.database.db.delete(homes);
      expect((await list()).items[0]).toEqual(unreadable);
      expect((await inject('GET', `/api/photos/${photo.id}/image`)).statusCode).toBe(200);
    });
  });

  describe('subjects', () => {
    const casement = { kind: 'type', id: 'window.casement' } as const;
    const bedroomWindow = { kind: 'use', id: 'souterrain-bedroom-window' } as const;
    const kitchenWindow = { kind: 'use', id: 'souterrain-kitchen-window' } as const;

    it('stores subjects on upload and resolves their names and status', async () => {
      const photo = await upload({ subjects: [bedroomWindow, casement, bedroomWindow] });
      // Subjects linked together are sorted by kind, then id; duplicates are dropped.
      expect(photo.subjects).toEqual([
        { ...casement, name: 'Casement window', status: 'current' },
        { ...bedroomWindow, name: expect.any(String), status: 'current' },
      ]);
      const plain = await upload();
      expect(plain.subjects).toEqual([]);
      expect(
        (
          await post(
            meta({
              subjects: Array.from({ length: 11 }, (_, i) => ({ kind: 'use', id: `u${i}` })),
            }),
          )
        ).statusCode,
      ).toBe(400);
      expect(
        (await post(meta({ subjects: [{ kind: 'room', id: 'x' }] as never }))).statusCode,
      ).toBe(400);
    });

    it('replaces the whole list on update and filters lists by subject', async () => {
      const a = await upload({ subjects: [bedroomWindow] });
      const b = await upload({ subjects: [kitchenWindow, casement] });
      await upload();
      expect(await ids('?subject=use:souterrain-bedroom-window')).toEqual([a.id]);
      expect(await ids('?subject=type:window.casement')).toEqual([b.id]);
      expect(await ids('?subject=use:nope')).toEqual([]);
      expect((await inject('GET', '/api/homes/mock-home/photos?subject=nope')).statusCode).toBe(
        400,
      );

      const updated = Photo.parse(
        (await inject('PATCH', `/api/photos/${b.id}`, { subjects: [bedroomWindow] })).json(),
      );
      expect(updated.subjects.map((s) => s.id)).toEqual(['souterrain-bedroom-window']);
      expect(await ids('?subject=use:souterrain-bedroom-window')).toEqual([b.id, a.id]);
      expect(await ids('?subject=type:window.casement')).toEqual([]);
      // Other fields leave the subjects alone.
      const noted = Photo.parse(
        (await inject('PATCH', `/api/photos/${b.id}`, { note: 'x' })).json(),
      );
      expect(noted.subjects.map((s) => s.id)).toEqual(['souterrain-bedroom-window']);
      const cleared = Photo.parse(
        (await inject('PATCH', `/api/photos/${b.id}`, { subjects: [] })).json(),
      );
      expect(cleared.subjects).toEqual([]);
    });

    it('resolves a use the model lost, an unknown type and a placement as missing or current', async () => {
      const placed = await inject('POST', '/api/homes/mock-home/placements', {
        typeId: 'furniture.bed',
        levelId: 'souterrain',
        position: { x: -3, z: 2.5 },
      });
      const bed = placed.json() as { id: string; name: string };
      const photo = await upload({
        subjects: [bedroomWindow, { kind: 'type', id: 'window.nope' }, { kind: 'use', id: bed.id }],
      });
      expect(photo.subjects.map((s) => [s.id, s.name, s.status])).toEqual([
        ['window.nope', null, 'missing'],
        [bed.id, bed.name, 'current'],
        ['souterrain-bedroom-window', expect.any(String), 'current'],
      ]);

      const model = (await homeStore(ctx.database.db).get('mock-home'))!;
      model.openings = model.openings.filter((o) => o.id !== bedroomWindow.id);
      expect((await inject('PUT', '/api/homes/mock-home', model)).statusCode).toBe(200);
      await inject('DELETE', `/api/homes/mock-home/placements/${bed.id}?version=1`);
      const after = Photo.parse((await inject('GET', `/api/photos/${photo.id}`)).json());
      expect(after.subjects.map((s) => [s.id, s.name, s.status])).toEqual([
        ['window.nope', null, 'missing'],
        [bed.id, bed.name, 'missing'],
        ['souterrain-bedroom-window', null, 'missing'],
      ]);
      // The link itself is kept, so the filter still finds the photo.
      expect(await ids('?subject=use:souterrain-bedroom-window')).toEqual([photo.id]);
    });

    it('a trashed and purged photo takes its links with it', async () => {
      const photo = await upload({ subjects: [casement] });
      await inject('DELETE', `/api/photos/${photo.id}`);
      expect(await ids('?subject=type:window.casement')).toEqual([]);
      const trash = TrashResponse.parse((await inject('GET', '/api/homes/mock-home/trash')).json());
      expect(trash.photos[0]!.subjects.map((s) => s.id)).toEqual(['window.casement']);
      await inject('POST', `/api/photos/${photo.id}/purge`);
      const left = await ctx.database.db.select().from(photoSubjects);
      expect(left).toEqual([]);
    });
  });

  describe('trash', () => {
    const trash = async () =>
      TrashResponse.parse((await inject('GET', '/api/homes/mock-home/trash')).json());

    it('soft-deletes into the trash, restores, and purges only from the trash', async () => {
      const photo = await upload();
      const kept = await upload();

      expect((await inject('POST', `/api/photos/${photo.id}/purge`)).statusCode).toBe(409);

      const deleted = Photo.parse((await inject('DELETE', `/api/photos/${photo.id}`)).json());
      expect(deleted.deletedAt).not.toBeNull();
      expect(Date.parse(deleted.purgeAt!) - Date.parse(deleted.deletedAt!)).toBe(30 * 86_400_000);
      // Deleting again keeps the first deletion time.
      const again = Photo.parse((await inject('DELETE', `/api/photos/${photo.id}`)).json());
      expect(again.deletedAt).toBe(deleted.deletedAt);

      expect(await ids()).toEqual([kept.id]);
      expect(await trash()).toMatchObject({ photos: [{ id: photo.id }], retentionDays: 30 });
      // Still reachable by id, with its image, so the trash view can show it.
      expect((await inject('GET', `/api/photos/${photo.id}`)).statusCode).toBe(200);
      expect((await inject('GET', `/api/photos/${photo.id}/thumbnail`)).statusCode).toBe(200);

      const restored = Photo.parse(
        (await inject('POST', `/api/photos/${photo.id}/restore`)).json(),
      );
      expect(restored).toMatchObject({ deletedAt: null, purgeAt: null });
      expect((await list()).total).toBe(2);
      expect((await trash()).photos).toEqual([]);

      await inject('DELETE', `/api/photos/${photo.id}`);
      expect((await inject('POST', `/api/photos/${photo.id}/purge`)).statusCode).toBe(204);
      expect((await inject('GET', `/api/photos/${photo.id}`)).statusCode).toBe(404);
      expect((await inject('GET', `/api/photos/${photo.id}/image`)).statusCode).toBe(404);
      expect((await inject('POST', `/api/photos/${photo.id}/purge`)).statusCode).toBe(404);
      expect(await ids()).toEqual([kept.id]);

      for (const url of ['/api/photos/nope', '/api/photos/nope/restore']) {
        const method = url.endsWith('restore') ? 'POST' : 'DELETE';
        expect((await inject(method, url)).statusCode).toBe(404);
      }
    });

    it('empties the trash of one home without touching anything else', async () => {
      const deleted = await upload();
      const kept = await upload();
      const other = await upload({}, 'another-home');
      await inject('DELETE', `/api/photos/${deleted.id}`);
      await inject('DELETE', `/api/photos/${other.id}`);
      const request = PhotoRequest.parse(
        (
          await inject('POST', '/api/homes/mock-home/photo-requests', {
            roomId: 'souterrain-bedroom',
            reason: 'Which wall has the window?',
            requester: 'agent',
          })
        ).json(),
      );
      await inject('DELETE', `/api/photo-requests/${request.id}`);

      const res = await inject('POST', '/api/homes/mock-home/trash/empty');
      expect(res.json()).toEqual({ purgedPhotos: 1, purgedRequests: 1 });
      expect(await ids()).toEqual([kept.id]);
      expect((await inject('GET', `/api/photos/${other.id}`)).statusCode).toBe(200);
      expect((await inject('GET', `/api/photo-requests/${request.id}`)).statusCode).toBe(404);
    });

    it('purges what has been in the trash longer than the retention period', async () => {
      const expired = await upload();
      const recent = await upload();
      const live = await upload();
      const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
      const { db } = ctx.database;
      await db
        .update(photos)
        .set({ deletedAt: daysAgo(31) })
        .where(eq(photos.id, expired.id));
      await db
        .update(photos)
        .set({ deletedAt: daysAgo(29) })
        .where(eq(photos.id, recent.id));

      // Listing the trash applies the retention; the server also does it hourly.
      expect((await trash()).photos.map((p) => p.id)).toEqual([recent.id]);
      expect((await inject('GET', `/api/photos/${expired.id}`)).statusCode).toBe(404);
      expect(await ids()).toEqual([live.id]);

      const store = photoStore(db, { retentionDays: 30 });
      expect(await store.purgeExpired()).toEqual({ purgedPhotos: 0, purgedRequests: 0 });
      expect(await store.purgeExpired(new Date(Date.now() + 2 * 86_400_000))).toEqual({
        purgedPhotos: 1,
        purgedRequests: 0,
      });
      expect(await ids()).toEqual([live.id]);
    });
  });
});
