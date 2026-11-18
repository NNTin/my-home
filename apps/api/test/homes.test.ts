import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiError, HomeModel, ListHomesResponse } from '@my-home/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { homes } from '../src/db/schema';
import { readHomeFile, seed, seedHomes } from '../src/db/seed';
import { defaultHomeFile } from '../src/paths';
import { REPLACED_ON_DEPLOY } from '../src/routes/homes';
import { clearUserdata, createTestApp } from './helpers';

const mockHome = await readHomeFile(defaultHomeFile);
const clone = (overrides: Partial<HomeModel> = {}): HomeModel => ({
  ...structuredClone(mockHome),
  ...overrides,
});

async function writeTempHome(model: unknown) {
  const dir = await mkdtemp(join(tmpdir(), 'my-home-'));
  const file = join(dir, 'home.json');
  await writeFile(file, JSON.stringify(model));
  return file;
}

describe('homes API', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeEach(async () => {
    if (ctx) await ctx.database.db.delete(homes);
    else ctx = await createTestApp();
    await clearUserdata(ctx);
  });
  afterAll(() => ctx.app.close());

  const inject = (method: 'GET' | 'PUT' | 'POST', url: string, payload?: unknown) =>
    ctx.app.inject({ method, url, ...(payload !== undefined && { payload: payload as object }) });

  describe('seed', () => {
    it('loads the mock home once (idempotent)', async () => {
      expect(await seed(ctx.database.db)).toEqual({ id: 'mock-home', status: 'inserted' });
      expect(await seed(ctx.database.db)).toEqual({ id: 'mock-home', status: 'unchanged' });

      const res = await inject('GET', '/api/homes');
      expect(res.statusCode).toBe(200);
      const body = ListHomesResponse.parse(res.json());
      expect(body.items.map((h) => [h.id, h.name, h.schemaVersion])).toEqual([
        ['mock-home', 'Mock home', 1],
      ]);
    });

    it('loads another file, and replaces only when asked', async () => {
      await seed(ctx.database.db);
      const other = clone({ id: 'other-home', name: 'Other home' });
      const file = await writeTempHome(other);
      expect(await seed(ctx.database.db, { file })).toEqual({
        id: 'other-home',
        status: 'inserted',
      });

      const renamed = await writeTempHome({ ...other, name: 'Renamed' });
      await seed(ctx.database.db, { file: renamed });
      expect((await inject('GET', '/api/homes/other-home')).json().name).toBe('Other home');
      expect(await seed(ctx.database.db, { file: renamed, replace: true })).toEqual({
        id: 'other-home',
        status: 'replaced',
      });
      expect((await inject('GET', '/api/homes/other-home')).json().name).toBe('Renamed');
    });

    it('seeds the real home before the mock home by default, so it is listed first', async () => {
      expect(await seedHomes(ctx.database.db)).toEqual([
        { id: 'home', status: 'inserted' },
        { id: 'mock-home', status: 'inserted' },
      ]);
      const body = ListHomesResponse.parse((await inject('GET', '/api/homes')).json());
      expect(body.items.map((h) => h.id)).toEqual(['home', 'mock-home']);
    });

    it('rejects an invalid file with path-based messages', async () => {
      const bad = clone();
      bad.openings[0]!.wallId = 'missing';
      const file = await writeTempHome(bad);
      await expect(seed(ctx.database.db, { file })).rejects.toThrow(
        /Invalid home file .*\n- openings\[0\]\.wallId: Unknown wall "missing"/,
      );
    });
  });

  describe('GET /api/homes', () => {
    it('returns an empty list before seeding', async () => {
      const res = await inject('GET', '/api/homes');
      expect(res.json()).toEqual({ items: [] });
    });

    it('honours and validates the limit query', async () => {
      await inject('POST', '/api/homes/import', clone({ id: 'a' }));
      await inject('POST', '/api/homes/import', clone({ id: 'b' }));
      const limited = await inject('GET', '/api/homes?limit=1');
      expect(ListHomesResponse.parse(limited.json()).items).toHaveLength(1);

      const invalid = await inject('GET', '/api/homes?limit=0');
      expect(invalid.statusCode).toBe(400);
      expect(ApiError.parse(invalid.json()).issues?.[0]?.path).toBe('limit');
    });
  });

  describe('GET /api/homes/:id', () => {
    it('returns the stored model', async () => {
      await seed(ctx.database.db);
      const res = await inject('GET', '/api/homes/mock-home');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(mockHome);
    });

    it('returns the effective model: the declination overlay on top of the stored one', async () => {
      await seed(ctx.database.db);
      const declination = { value: -1.5, source: 'measured' as const };
      const set = await inject('PUT', '/api/homes/mock-home/settings', {
        version: 0,
        magneticDeclination: declination,
      });
      expect(set.statusCode, set.body).toBe(200);
      const effective = {
        ...mockHome,
        building: { ...mockHome.building, magneticDeclination: declination },
      };
      expect((await inject('GET', '/api/homes/mock-home')).json()).toEqual(effective);
      expect(JSON.parse((await inject('GET', '/api/homes/mock-home/export')).body)).toEqual(
        effective,
      );

      // Cleared: the stored model's own value again.
      await inject('PUT', '/api/homes/mock-home/settings', {
        version: 1,
        magneticDeclination: null,
      });
      expect((await inject('GET', '/api/homes/mock-home')).json()).toEqual(mockHome);
    });

    it('answers PUT and import with the effective model too', async () => {
      await seed(ctx.database.db);
      const declination = { value: 2, source: 'measured' as const };
      await inject('PUT', '/api/homes/mock-home/settings', {
        version: 0,
        magneticDeclination: declination,
      });
      const updated = clone({ name: 'Updated' });
      const expected = {
        ...updated,
        building: { ...updated.building, magneticDeclination: declination },
      };
      expect((await inject('PUT', '/api/homes/mock-home', updated)).json()).toEqual(expected);
      expect((await inject('POST', '/api/homes/import', updated)).json()).toEqual(expected);
      expect((await inject('GET', '/api/homes/mock-home')).json()).toEqual(expected);
    });

    it('returns 404 for an unknown id', async () => {
      const res = await inject('GET', '/api/homes/nope');
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'Not Found', message: 'Home "nope" not found' });
    });
  });

  describe('PUT /api/homes/:id', () => {
    it('replaces the whole model', async () => {
      await seed(ctx.database.db);
      const updated = clone({ name: 'Updated', outdoorAreas: [] });
      const res = await inject('PUT', '/api/homes/mock-home', updated);
      expect(res.statusCode).toBe(200);
      // The next deploy's sync from data/homes replaces it.
      expect(res.headers.warning).toBe(REPLACED_ON_DEPLOY);
      expect(REPLACED_ON_DEPLOY).toBe('299 - "Replaced from data/homes on the next deploy"');
      expect((await inject('GET', '/api/homes/mock-home')).json()).toEqual(updated);
      const list = ListHomesResponse.parse((await inject('GET', '/api/homes')).json());
      expect(list.items[0]?.name).toBe('Updated');
    });

    it('returns 404 when the home does not exist', async () => {
      const res = await inject('PUT', '/api/homes/mock-home', clone());
      expect(res.statusCode).toBe(404);
    });

    it('rejects a body whose id differs from the URL', async () => {
      await seed(ctx.database.db);
      const res = await inject('PUT', '/api/homes/mock-home', clone({ id: 'other' }));
      expect(res.statusCode).toBe(400);
      expect(ApiError.parse(res.json()).issues).toEqual([
        { path: 'id', message: 'Body id "other" does not match the URL id "mock-home"' },
      ]);
    });

    it('returns 400 with path-based issues for an invalid model', async () => {
      await seed(ctx.database.db);
      const bad = clone();
      bad.openings[2]!.width.value = 50;
      bad.rooms[0]!.levelId = 'attic';
      const res = await inject('PUT', '/api/homes/mock-home', bad);
      expect(res.statusCode).toBe(400);
      const body = ApiError.parse(res.json());
      expect(body.message).toMatch(/^Invalid request body: rooms\[0\]\.levelId: Unknown level/);
      expect(body.issues).toEqual(
        expect.arrayContaining([
          { path: 'rooms[0].levelId', message: 'Unknown level "attic"' },
          { path: 'openings[2].width', message: expect.stringMatching(/only 10.3 m long/) },
        ]),
      );
      // The stored model is untouched.
      expect((await inject('GET', '/api/homes/mock-home')).json()).toEqual(mockHome);
    });
  });

  describe('import and export', () => {
    it('creates on first import and replaces on the next', async () => {
      const created = await inject('POST', '/api/homes/import', clone());
      expect(created.statusCode).toBe(201);
      const replaced = await inject('POST', '/api/homes/import', clone({ name: 'Again' }));
      expect(replaced.statusCode).toBe(200);
      expect([created.headers.warning, replaced.headers.warning]).toEqual([
        REPLACED_ON_DEPLOY,
        REPLACED_ON_DEPLOY,
      ]);
      expect(
        ListHomesResponse.parse((await inject('GET', '/api/homes')).json()).items,
      ).toHaveLength(1);
    });

    it('round-trips: export then import gives an identical model', async () => {
      await seed(ctx.database.db);
      const exported = await inject('GET', '/api/homes/mock-home/export');
      expect(exported.statusCode).toBe(200);
      expect(exported.headers['content-type']).toMatch(/^application\/json/);
      expect(exported.headers['content-disposition']).toBe('attachment; filename="mock-home.json"');
      expect(JSON.parse(exported.body)).toEqual(mockHome);

      await ctx.database.db.delete(homes);
      const imported = await ctx.app.inject({
        method: 'POST',
        url: '/api/homes/import',
        headers: { 'content-type': 'application/json' },
        payload: exported.body,
      });
      expect(imported.statusCode).toBe(201);
      const reExported = await inject('GET', '/api/homes/mock-home/export');
      expect(reExported.body).toBe(exported.body);
    });

    it('returns 404 when exporting an unknown home', async () => {
      expect((await inject('GET', '/api/homes/nope/export')).statusCode).toBe(404);
    });

    it('rejects invalid imports with readable issues', async () => {
      const dup = clone();
      dup.walls[1]!.id = dup.walls[0]!.id;
      const res = await inject('POST', '/api/homes/import', dup);
      expect(res.statusCode).toBe(400);
      expect(ApiError.parse(res.json()).issues).toContainEqual({
        path: 'walls[1].id',
        message: 'Duplicate id "souterrain-wall-back" (already used by walls[0])',
      });
      expect((await inject('GET', '/api/homes')).json()).toEqual({ items: [] });
    });

    it('rejects malformed JSON and missing fields', async () => {
      const malformed = await ctx.app.inject({
        method: 'POST',
        url: '/api/homes/import',
        headers: { 'content-type': 'application/json' },
        payload: '{"id":',
      });
      expect(malformed.statusCode).toBe(400);
      expect(ApiError.parse(malformed.json()).statusCode).toBe(400);

      const missing = await inject('POST', '/api/homes/import', { schemaVersion: 1, id: 'x' });
      expect(missing.statusCode).toBe(400);
      expect(ApiError.parse(missing.json()).issues?.map((i) => i.path)).toEqual(
        expect.arrayContaining(['name', 'building', 'levels']),
      );
    });
  });
});
