import {
  CatalogUsageResponse,
  ListCatalogTypesResponse,
  ListUsesResponse,
  modelUses,
  Placement,
} from '@my-home/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readHomeFile, seedHomes } from '../src/db/seed';
import { openingOverrides, placements } from '../src/db/userdata-schema';
import { defaultHomeFile, defaultSeedFiles } from '../src/paths';
import { clearUserdata, createTestApp, injector } from './helpers';

describe('where-used and the catalogue', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let inject: ReturnType<typeof injector>;
  beforeAll(async () => {
    ctx = await createTestApp();
    inject = injector(ctx);
  });
  beforeEach(async () => {
    await clearUserdata(ctx);
    await seedHomes(ctx.database.db, { replace: true });
  });
  afterAll(() => ctx.app.close());

  const uses = async (query = '') =>
    ListUsesResponse.parse((await inject('GET', `/api/homes/mock-home/uses${query}`)).json()).items;
  const place = async (body: object) =>
    Placement.parse(
      (
        await inject('POST', '/api/homes/mock-home/placements', {
          typeId: 'furniture.bed',
          levelId: 'souterrain',
          position: { x: -3, z: 2.5 },
          ...body,
        })
      ).json(),
    );

  it('lists git uses with overrides, placements and orphans', async () => {
    const model = await readHomeFile(defaultHomeFile);
    const git = modelUses(model);
    await inject('PUT', '/api/homes/mock-home/opening-overrides/souterrain-bedroom-window', {
      version: 0,
      params: { frameColor: '#383e42' },
    });
    const bed = await place({});
    const removed = await place({ typeId: 'furniture.chair' });
    await inject('DELETE', `/api/homes/mock-home/placements/${removed.id}?version=1`);
    // Orphans: an override of a use git no longer has, and a placement whose room is gone.
    await ctx.database.db.insert(openingOverrides).values({
      homeId: 'mock-home',
      useId: 'old-window',
      typeId: 'window.casement',
      params: { sashes: 2 },
    });
    await ctx.database.db.insert(placements).values({
      homeId: 'mock-home',
      id: 'souterrain-sofa-1',
      typeId: 'furniture.sofa',
      name: 'Old sofa',
      levelId: 'souterrain',
      roomId: 'souterrain-gone',
      x: -3,
      z: -2,
      rotationY: 0,
    });

    const all = await uses();
    expect(all.map((u) => u.id)).toEqual([
      ...git.map((u) => u.id),
      'old-window',
      bed.id,
      'souterrain-sofa-1',
    ]);
    const window = all.find((u) => u.id === 'souterrain-bedroom-window')!;
    expect(window).toMatchObject({
      source: 'git',
      kind: 'openings',
      name: 'Bedroom · front window',
      levelId: 'souterrain',
      roomIds: ['souterrain-bedroom'],
      where: 'Souterrain · Bedroom',
      overrides: { frameColor: '#383e42' },
      version: 1,
      status: 'ok',
    });
    expect(window.effective).toMatchObject({ frameColor: '#383e42', sashes: 1 });
    expect(all.find((u) => u.id === 'souterrain-kitchen-window')).toMatchObject({
      version: 0,
      overrides: {},
      updatedAt: null,
    });
    expect(all.find((u) => u.id === bed.id)).toMatchObject({
      source: 'db',
      kind: 'furniture',
      where: 'Souterrain · Bedroom',
      roomIds: ['souterrain-bedroom'],
      status: 'ok',
      effective: { width: 1.6 },
    });

    const attention = await uses('?status=needs-attention');
    expect(attention.map((u) => [u.id, u.problems])).toEqual([
      ['old-window', ['not in the home model any more']],
      ['souterrain-sofa-1', ['room "souterrain-gone" is not in the home model']],
    ]);
    expect((await uses('?typeId=furniture.bed')).map((u) => u.id)).toEqual([bed.id]);
    expect((await inject('GET', '/api/homes/nope/uses')).statusCode).toBe(404);
  });

  it('counts git uses of every home plus active placements per type', async () => {
    await place({});
    await place({});
    const chair = await place({ typeId: 'furniture.chair' });
    await inject('DELETE', `/api/homes/mock-home/placements/${chair.id}?version=1`);
    const { counts } = CatalogUsageResponse.parse(
      (await inject('GET', '/api/catalog/usage')).json(),
    );
    const expected: Record<string, number> = {};
    for (const file of defaultSeedFiles) {
      for (const u of modelUses(await readHomeFile(file)))
        expected[u.typeId] = (expected[u.typeId] ?? 0) + 1;
    }
    expect(counts['furniture.bed']).toBe(2);
    expect(counts['furniture.chair']).toBe(0);
    expect(counts['furniture.sofa']).toBe(0);
    expect(counts['window.casement']).toBe(expected['window.casement']);
    expect(counts['door.interior']).toBe(expected['door.interior']);
  });

  it('serves the catalogue types with their params', async () => {
    const { items } = ListCatalogTypesResponse.parse(
      (await inject('GET', '/api/catalog/types')).json(),
    );
    const bed = items.find((t) => t.id === 'furniture.bed')!;
    expect(bed).toMatchObject({
      kind: 'furniture',
      name: 'Bed',
      category: 'Bed room',
      placement: 'floor',
    });
    expect(bed.params.width).toMatchObject({ type: 'length', tier: 'basic', min: 0.8, max: 2.2 });
    expect(items.find((t) => t.id === 'door.french')!.openingTypes).toEqual(['french-door']);
  });
});
