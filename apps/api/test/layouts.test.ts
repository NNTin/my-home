import {
  ApiError,
  Layout,
  LayoutConflict,
  ListLayoutsResponse,
  type LayoutItem,
} from '@my-home/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { homes } from '../src/db/schema';
import { seed } from '../src/db/seed';
import { createTestApp } from './helpers';
import { mockHomeFile } from './fixtures';

const item = (id: string, overrides: Partial<LayoutItem> = {}): LayoutItem => ({
  id,
  typeId: 'bed',
  levelId: 'souterrain',
  roomId: 'souterrain-bedroom',
  position: { x: -3, z: 2.5 },
  rotationY: 0,
  props: {},
  ...overrides,
});

describe('layouts API', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeEach(async () => {
    if (ctx) await ctx.database.db.delete(homes);
    else ctx = await createTestApp();
    await seed(ctx.database.db, { file: mockHomeFile });
  });
  afterAll(() => ctx.app.close());

  const inject = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, payload?: unknown) =>
    ctx.app.inject({ method, url, ...(payload !== undefined && { payload: payload as object }) });

  const create = async (name = 'Default', items: LayoutItem[] = []) => {
    const res = await inject('POST', '/api/homes/mock-home/layouts', { name, items });
    expect(res.statusCode).toBe(201);
    return Layout.parse(res.json());
  };

  const list = async () =>
    ListLayoutsResponse.parse((await inject('GET', '/api/homes/mock-home/layouts')).json()).items;

  describe('create, list and get', () => {
    it('creates layouts at version 1 and lists them oldest first with item counts', async () => {
      const first = await create('Default', [item('a'), item('b')]);
      expect(first).toMatchObject({
        homeId: 'mock-home',
        name: 'Default',
        schemaVersion: 1,
        version: 1,
        items: [item('a'), item('b')],
      });
      await create('Empty');

      expect((await list()).map((l) => [l.name, l.itemCount, l.version])).toEqual([
        ['Default', 2, 1],
        ['Empty', 0, 1],
      ]);
      const res = await inject('GET', `/api/layouts/${first.id}`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(first);
    });

    it('defaults items to an empty list', async () => {
      const res = await inject('POST', '/api/homes/mock-home/layouts', { name: 'Empty' });
      expect(Layout.parse(res.json()).items).toEqual([]);
    });

    it('returns 404 for an unknown home or layout', async () => {
      expect((await inject('GET', '/api/homes/nope/layouts')).statusCode).toBe(404);
      const created = await inject('POST', '/api/homes/nope/layouts', { name: 'x' });
      expect(created.statusCode).toBe(404);
      expect(created.json()).toMatchObject({ message: 'Home "nope" not found' });
      const res = await inject('GET', '/api/layouts/nope');
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ message: 'Layout "nope" not found' });
    });

    it('rejects invalid items with path-based issues', async () => {
      const shape = await inject('POST', '/api/homes/mock-home/layouts', {
        name: 'Bad',
        items: [item('a'), { ...item('c'), position: { x: 'west' } }],
      });
      expect(shape.statusCode).toBe(400);
      expect(ApiError.parse(shape.json()).issues?.map((i) => i.path)).toEqual([
        'items[1].position.x',
        'items[1].position.z',
      ]);
      const duplicate = await inject('POST', '/api/homes/mock-home/layouts', {
        name: 'Bad',
        items: [item('a'), item('a')],
      });
      expect(ApiError.parse(duplicate.json()).issues).toEqual([
        { path: 'items[1].id', message: 'Duplicate item id "a" (already used by [0])' },
      ]);
      expect(await list()).toEqual([]);
    });
  });

  describe('PUT /api/layouts/:id', () => {
    it('replaces name and items and bumps the version', async () => {
      const layout = await create('Default', [item('a')]);
      const res = await inject('PUT', `/api/layouts/${layout.id}`, {
        name: 'Renamed',
        items: [item('a', { position: { x: -2, z: 3 }, rotationY: Math.PI / 2 }), item('b')],
        version: 1,
      });
      expect(res.statusCode).toBe(200);
      const updated = Layout.parse(res.json());
      expect(updated).toMatchObject({ name: 'Renamed', version: 2 });
      expect(updated.items.map((i) => i.id)).toEqual(['a', 'b']);
      expect(updated.items[0]?.position).toEqual({ x: -2, z: 3 });
      expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(layout.updatedAt));
      expect((await inject('GET', `/api/layouts/${layout.id}`)).json()).toEqual(updated);
    });

    it('returns 409 with the current version when the version is stale', async () => {
      const layout = await create();
      const body = { name: 'Default', items: [item('a')], version: 1 };
      expect((await inject('PUT', `/api/layouts/${layout.id}`, body)).statusCode).toBe(200);

      const stale = await inject('PUT', `/api/layouts/${layout.id}`, { ...body, items: [] });
      expect(stale.statusCode).toBe(409);
      expect(LayoutConflict.parse(stale.json())).toMatchObject({
        error: 'Conflict',
        currentVersion: 2,
      });
      // The stored layout is untouched; retrying with the current version overwrites it.
      expect(Layout.parse((await inject('GET', `/api/layouts/${layout.id}`)).json()).items).toEqual(
        [item('a')],
      );
      const overwrite = await inject('PUT', `/api/layouts/${layout.id}`, {
        ...body,
        items: [],
        version: 2,
      });
      expect(Layout.parse(overwrite.json())).toMatchObject({ version: 3, items: [] });
    });

    it('requires a version and returns 404 for an unknown layout', async () => {
      const layout = await create();
      const missing = await inject('PUT', `/api/layouts/${layout.id}`, { name: 'x', items: [] });
      expect(missing.statusCode).toBe(400);
      expect(ApiError.parse(missing.json()).issues?.[0]?.path).toBe('version');
      const unknown = await inject('PUT', '/api/layouts/nope', {
        name: 'x',
        items: [],
        version: 1,
      });
      expect(unknown.statusCode).toBe(404);
    });
  });

  describe('delete and duplicate', () => {
    it('deletes a layout', async () => {
      const layout = await create();
      expect((await inject('DELETE', `/api/layouts/${layout.id}`)).statusCode).toBe(204);
      expect((await inject('GET', `/api/layouts/${layout.id}`)).statusCode).toBe(404);
      expect((await inject('DELETE', `/api/layouts/${layout.id}`)).statusCode).toBe(404);
    });

    it('duplicates a layout under a new id, with an optional name', async () => {
      const layout = await create('Default', [item('a')]);
      const copy = Layout.parse(
        (await inject('POST', `/api/layouts/${layout.id}/duplicate`)).json(),
      );
      expect(copy).toMatchObject({ name: 'Default (copy)', version: 1, items: layout.items });
      expect(copy.id).not.toBe(layout.id);

      const named = await inject('POST', `/api/layouts/${layout.id}/duplicate`, { name: 'Other' });
      expect(named.statusCode).toBe(201);
      expect(Layout.parse(named.json()).name).toBe('Other');
      expect(await list()).toHaveLength(3);
      expect((await inject('POST', '/api/layouts/nope/duplicate', {})).statusCode).toBe(404);
    });

    it('deletes the layouts of a deleted home', async () => {
      await create();
      await ctx.database.db.delete(homes);
      await seed(ctx.database.db, { file: mockHomeFile });
      expect(await list()).toEqual([]);
    });
  });

  describe('import and export', () => {
    it('round-trips: export then import gives the same layout under a new id', async () => {
      const items = [
        item('a', { props: { color: '#884422', tags: ['x', 1, null, { deep: true }] } }),
        item('b', { typeId: 'sofa', rotationY: -Math.PI / 4 }),
      ];
      const layout = await create('Living room: v2', items);
      const exported = await inject('GET', `/api/layouts/${layout.id}/export`);
      expect(exported.statusCode).toBe(200);
      expect(exported.headers['content-type']).toMatch(/^application\/json/);
      expect(exported.headers['content-disposition']).toBe(
        'attachment; filename="Living-room-v2.layout.json"',
      );
      expect(JSON.parse(exported.body)).toEqual({
        schemaVersion: 1,
        name: 'Living room: v2',
        homeId: 'mock-home',
        items,
      });

      const imported = await ctx.app.inject({
        method: 'POST',
        url: '/api/homes/mock-home/layouts/import',
        headers: { 'content-type': 'application/json' },
        payload: exported.body,
      });
      expect(imported.statusCode).toBe(201);
      const copy = Layout.parse(imported.json());
      expect(copy.id).not.toBe(layout.id);
      expect(copy).toMatchObject({ name: layout.name, version: 1, items });
      const reExported = await inject('GET', `/api/layouts/${copy.id}/export`);
      expect(reExported.body).toBe(exported.body);
    });

    it('accepts a full layout (server fields ignored) and rejects invalid files', async () => {
      const layout = await create('Default', [item('a')]);
      const res = await inject('POST', '/api/homes/mock-home/layouts/import', {
        ...layout,
        version: 7,
      });
      expect(Layout.parse(res.json())).toMatchObject({ version: 1, items: [item('a')] });

      const bad = await inject('POST', '/api/homes/mock-home/layouts/import', {
        schemaVersion: 99,
        name: 'x',
        items: [],
      });
      expect(bad.statusCode).toBe(400);
      expect(ApiError.parse(bad.json()).issues?.[0]?.path).toBe('schemaVersion');
      const unknownHome = await inject('POST', '/api/homes/nope/layouts/import', {
        schemaVersion: 1,
        name: 'x',
        items: [],
      });
      expect(unknownHome.statusCode).toBe(404);
      expect((await inject('GET', '/api/layouts/nope/export')).statusCode).toBe(404);
    });
  });

  describe('independence from the building', () => {
    it('keeps layouts and stale references when the home is re-seeded or replaced', async () => {
      const stale = [item('a', { levelId: 'attic', roomId: 'gone' })];
      const layout = await create('Default', stale);

      await seed(ctx.database.db, { file: mockHomeFile, replace: true });
      const home = (await inject('GET', '/api/homes/mock-home')).json();
      await inject('PUT', '/api/homes/mock-home', { ...home, name: 'Renamed home' });
      await inject('POST', '/api/homes/import', home);

      const res = await inject('GET', `/api/layouts/${layout.id}`);
      expect(res.statusCode).toBe(200);
      expect(Layout.parse(res.json()).items).toEqual(stale);
    });
  });
});
