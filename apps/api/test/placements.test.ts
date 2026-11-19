import { ListPlacementsResponse, Placement, UseConflict } from '@my-home/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { placementStore } from '../src/db/placements';
import { seedHomes } from '../src/db/seed';
import { issuedIds } from '../src/db/userdata-schema';
import { clearUserdata, createTestApp, injector } from './helpers';
import { testSeedFiles } from './fixtures';

const DAY = 24 * 60 * 60 * 1000;
const url = '/api/homes/mock-home/placements';

describe('placements', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let inject: ReturnType<typeof injector>;
  beforeAll(async () => {
    ctx = await createTestApp();
    inject = injector(ctx);
  });
  beforeEach(async () => {
    await clearUserdata(ctx);
    await seedHomes(ctx.database.db, { files: testSeedFiles });
  });
  afterAll(() => ctx.app.close());

  const place = async (body: object = {}) => {
    const res = await inject('POST', url, {
      typeId: 'furniture.bed',
      levelId: 'souterrain',
      position: { x: -3, z: 2.5 },
      rotationY: 0,
      ...body,
    });
    expect(res.statusCode, res.body).toBe(201);
    return Placement.parse(res.json());
  };
  const list = async (query = '') =>
    ListPlacementsResponse.parse((await inject('GET', `${url}${query}`)).json()).items;

  describe('POST', () => {
    it('assigns the id and name and derives the room', async () => {
      const bed = await place({ roomId: 'souterrain-kitchen' }); // a sent roomId is ignored
      expect(bed).toMatchObject({
        id: 'souterrain-bed-1',
        homeId: 'mock-home',
        typeId: 'furniture.bed',
        name: 'Bedroom · Bed',
        levelId: 'souterrain',
        roomId: 'souterrain-bedroom',
        params: {},
        version: 1,
        removedAt: null,
        purgeAt: null,
      });
      const second = await place({ params: { width: 1.4, color: '#AABBCC' } });
      expect(second).toMatchObject({
        id: 'souterrain-bed-2',
        name: 'Bedroom · Bed 2',
        params: { width: 1.4, color: '#aabbcc' },
      });
      const kitchen = await place({ typeId: 'furniture.table', position: { x: 3, z: -2 } });
      expect(kitchen).toMatchObject({ id: 'souterrain-table-1', name: 'Kitchen · Round table' });
      const named = await place({ name: 'Guest bed', levelId: 'ground-floor' });
      expect(named).toMatchObject({ id: 'ground-floor-bed-1', name: 'Guest bed' });
    });

    it('uses the level outside any room and never reuses an id', async () => {
      const outside = await place({ position: { x: 40, z: 40 } });
      expect(outside).toMatchObject({
        id: 'souterrain-bed-1',
        roomId: null,
        name: 'Souterrain · Bed',
      });
      // Ids issued earlier (even of purged placements) are skipped.
      await ctx.database.db
        .insert(issuedIds)
        .values({ homeId: 'mock-home', id: 'souterrain-bed-7' });
      expect((await place()).id).toBe('souterrain-bed-8');
    });

    it('places fixtures with stable ids: one per light, kept through moves and the trash', async () => {
      const light = (x: number) =>
        place({
          typeId: 'fixture.downlight',
          position: { x, z: -2 },
          params: { light: 'neutral' },
        });
      const first = await light(3);
      expect(first).toMatchObject({
        id: 'souterrain-downlight-1',
        typeId: 'fixture.downlight',
        name: 'Kitchen · Downlight',
        params: { light: 'neutral' },
      });
      const second = await light(3.5);
      expect(second).toMatchObject({ id: 'souterrain-downlight-2', name: 'Kitchen · Downlight 2' });
      const moved = await inject('PATCH', `${url}/${first.id}`, {
        version: 1,
        position: { x: 3.2, z: -2.2 },
      });
      expect(Placement.parse(moved.json()).id).toBe(first.id);
      await inject('DELETE', `${url}/${second.id}?version=1`);
      // A removed light's id is never handed to the next one.
      expect((await light(4)).id).toBe('souterrain-downlight-3');
      const uses = await inject('GET', '/api/homes/mock-home/uses?typeId=fixture.downlight');
      expect(
        uses.json().items.map((u: { id: string; kind: string }) => [u.id, u.kind]),
      ).toContainEqual([first.id, 'fixtures']);
    });

    it('rejects unknown and non-furniture types, unknown levels and invalid params', async () => {
      const post = (body: object) =>
        inject('POST', url, {
          typeId: 'furniture.bed',
          levelId: 'souterrain',
          position: { x: -3, z: 2.5 },
          ...body,
        });
      expect((await post({ typeId: 'furniture.unicorn' })).statusCode).toBe(400);
      expect((await post({ typeId: 'window.casement' })).json().message).toMatch(
        /not a furniture or fixture/,
      );
      expect((await post({ levelId: 'cellar' })).statusCode).toBe(404);
      const bad = await post({ params: { width: 5, height: 1 } });
      expect(bad.statusCode).toBe(400);
      expect(
        bad
          .json()
          .issues.map((i: { path: string }) => i.path)
          .sort(),
      ).toEqual(['params', 'params.width']);
      expect(
        (
          await inject('POST', '/api/homes/nope/placements', {
            typeId: 'furniture.bed',
            levelId: 'souterrain',
            position: { x: 0, z: 0 },
          })
        ).statusCode,
      ).toBe(404);
      expect(await list()).toEqual([]);
    });
  });

  describe('PATCH', () => {
    it('updates fields, bumps the version and re-derives the room on a move', async () => {
      const bed = await place();
      const res = await inject('PATCH', `${url}/${bed.id}`, {
        version: 1,
        name: 'Guest bed',
        position: { x: 3, z: 2 },
        rotationY: Math.PI / 2,
        params: { color: '#112233' },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(Placement.parse(res.json())).toMatchObject({
        id: bed.id,
        name: 'Guest bed',
        roomId: 'souterrain-bathroom',
        position: { x: 3, z: 2 },
        params: { color: '#112233' },
        version: 2,
      });
    });

    it('answers 409 on a stale version', async () => {
      const bed = await place();
      await inject('PATCH', `${url}/${bed.id}`, { version: 1, name: 'A' });
      const res = await inject('PATCH', `${url}/${bed.id}`, { version: 1, name: 'B' });
      expect(res.statusCode).toBe(409);
      expect(UseConflict.parse(res.json())).toMatchObject({ currentVersion: 2 });
    });

    it('refuses a size change that pushes a fitting footprint out of its room (422)', async () => {
      // Against the bedroom's east wall (x = -0.5): 1.6 m wide fits, 2.2 m does not.
      const bed = await place({ position: { x: -1.4, z: 2.5 } });
      const res = await inject('PATCH', `${url}/${bed.id}`, { version: 1, params: { width: 2.2 } });
      expect(res.statusCode).toBe(422);
      expect(res.json().message).toMatch(/reaches outside the room/);
      // Already outside: no false rejection.
      const out = await place({ position: { x: -0.7, z: 2.5 } });
      const ok = await inject('PATCH', `${url}/${out.id}`, { version: 1, params: { width: 2 } });
      expect(ok.statusCode, ok.body).toBe(200);
    });

    it('validates params against the type (400)', async () => {
      const bed = await place();
      const res = await inject('PATCH', `${url}/${bed.id}`, { version: 1, params: { sashes: 2 } });
      expect(res.statusCode).toBe(400);
      expect((await inject('PATCH', `${url}/nope`, { version: 1, name: 'x' })).statusCode).toBe(
        404,
      );
    });
  });

  describe('remove and restore', () => {
    it('moves to the trash and back; lists with include=removed', async () => {
      const bed = await place();
      const stale = await inject('DELETE', `${url}/${bed.id}?version=7`);
      expect(stale.statusCode).toBe(409);
      expect((await inject('DELETE', `${url}/${bed.id}`)).statusCode).toBe(400);
      const removed = Placement.parse(
        (await inject('DELETE', `${url}/${bed.id}?version=1`)).json(),
      );
      expect(removed.removedAt).not.toBeNull();
      expect(Date.parse(removed.purgeAt!) - Date.parse(removed.removedAt!)).toBe(30 * DAY);
      expect((await inject('DELETE', `${url}/${bed.id}?version=2`)).statusCode).toBe(409);
      expect(await list()).toEqual([]);
      expect((await list('?include=removed')).map((p) => p.id)).toEqual([bed.id]);
      const patch = await inject('PATCH', `${url}/${bed.id}`, { version: 2, name: 'x' });
      expect(patch.statusCode).toBe(409);

      const restored = await inject('POST', `${url}/${bed.id}/restore`);
      expect(Placement.parse(restored.json())).toMatchObject({ removedAt: null, version: 3 });
      expect((await inject('POST', `${url}/${bed.id}/restore`)).statusCode).toBe(409);
      expect((await list()).map((p) => p.id)).toEqual([bed.id]);
    });

    it('purges the trash after the retention period, keeping the id issued', async () => {
      const store = placementStore(ctx.database.db, { retentionDays: 30 });
      const kept = await place();
      const gone = await place();
      await inject('DELETE', `${url}/${gone.id}?version=1`);
      expect(await store.purgeExpired(new Date(Date.now() + 29 * DAY))).toEqual({
        purgedPlacements: 0,
      });
      expect(await store.purgeExpired(new Date(Date.now() + 31 * DAY))).toEqual({
        purgedPlacements: 1,
      });
      expect((await list('?include=removed')).map((p) => p.id)).toEqual([kept.id]);
      // Its history went with it: the use is unknown now.
      expect((await inject('GET', `/api/homes/mock-home/uses/${gone.id}/history`)).statusCode).toBe(
        404,
      );
      expect(
        (await inject('GET', `/api/homes/mock-home/uses/${kept.id}/history`)).json().items,
      ).toHaveLength(1);
      expect((await place()).id).toBe('souterrain-bed-3');
    });
  });
});
