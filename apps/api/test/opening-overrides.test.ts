import { HomeModel, ListUsesResponse, OpeningOverride, UseConflict } from '@my-home/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { homeStore } from '../src/db/homes';
import { readHomeFile, seedHomes } from '../src/db/seed';
import { defaultHomeFile } from '../src/paths';
import { clearUserdata, createTestApp, injector } from './helpers';

const base = '/api/homes/mock-home/opening-overrides';

describe('opening overrides', () => {
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

  const put = (useId: string, body: object) => inject('PUT', `${base}/${useId}`, body);

  it('creates with version 0 and updates with the current version', async () => {
    const created = await put('souterrain-kitchen-window', {
      version: 0,
      params: { frameColor: '#383E42', sashes: 2 },
    });
    expect(created.statusCode, created.body).toBe(200);
    expect(OpeningOverride.parse(created.json())).toMatchObject({
      homeId: 'mock-home',
      useId: 'souterrain-kitchen-window',
      typeId: 'window.casement',
      params: { frameColor: '#383e42', sashes: 2 },
      version: 1,
    });
    expect((await put('souterrain-kitchen-window', { version: 0, params: {} })).statusCode).toBe(
      409,
    );
    const stale = await put('souterrain-kitchen-window', { version: 5, params: {} });
    expect(UseConflict.parse(stale.json())).toMatchObject({ statusCode: 409, currentVersion: 1 });

    // An empty object keeps the row (and its version history).
    const cleared = await put('souterrain-kitchen-window', { version: 1, params: {} });
    expect(OpeningOverride.parse(cleared.json())).toMatchObject({ params: {}, version: 2 });
    const items = (await inject('GET', base)).json().items;
    expect(items.map((o: OpeningOverride) => [o.useId, o.version])).toEqual([
      ['souterrain-kitchen-window', 2],
    ]);
    expect((await put('ground-floor-entrance-door', { version: 1, params: {} })).statusCode).toBe(
      409,
    );
  });

  it('rejects unknown uses (404), design params (400) and sashes that do not fit (422)', async () => {
    expect((await put('nope', { version: 0, params: {} })).statusCode).toBe(404);
    expect(
      (await inject('PUT', '/api/homes/nope/opening-overrides/x', { version: 0, params: {} }))
        .statusCode,
    ).toBe(404);
    const design = await put('souterrain-kitchen-window', {
      version: 0,
      params: { frameWidth: 0.06 },
    });
    expect(design.statusCode).toBe(400);
    expect(design.json().issues[0].path).toBe('params');
    const tooMany = await put('souterrain-bathroom-window', { version: 0, params: { sashes: 4 } });
    expect(tooMany.statusCode).toBe(422);
    expect(tooMany.json().message).toBe('4 sashes need at least 100.0 cm, the opening is 90.0 cm');
    expect((await inject('GET', base)).json().items).toEqual([]);
  });

  it('flags an override whose use changed type in git as needs-attention', async () => {
    await put('souterrain-patio-door', { version: 0, params: { frameColor: '#ffffff' } });
    await put('souterrain-kitchen-window', { version: 0, params: { sashes: 2 } });
    // A later git change: the kitchen window becomes a French door, which has no sashes.
    const model = await readHomeFile(defaultHomeFile);
    const changed = HomeModel.parse({
      ...model,
      openings: model.openings.map((o) =>
        o.id === 'souterrain-kitchen-window'
          ? { ...o, typeId: 'door.french', type: 'french-door' }
          : o,
      ),
    });
    await homeStore(ctx.database.db).replace(changed);

    const uses = ListUsesResponse.parse(
      (await inject('GET', '/api/homes/mock-home/uses?status=needs-attention')).json(),
    ).items;
    expect(uses.map((u) => [u.id, u.typeId, u.problems])).toEqual([
      [
        'souterrain-kitchen-window',
        'door.french',
        ['type changed from window.casement', 'ignored: sashes'],
      ],
    ]);
    expect(uses[0]).toMatchObject({ overrides: { sashes: 2 }, version: 1, source: 'git' });

    // Writing it again adopts the new type.
    const res = await put('souterrain-kitchen-window', { version: 1, params: { leaves: 2 } });
    expect(OpeningOverride.parse(res.json())).toMatchObject({ typeId: 'door.french', version: 2 });
    expect(
      (await inject('GET', '/api/homes/mock-home/uses?status=needs-attention')).json().items,
    ).toEqual([]);
  });
});
