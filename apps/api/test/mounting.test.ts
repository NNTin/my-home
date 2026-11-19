import { ListHistoryResponse, ListUsesResponse, Placement, UndoResponse } from '@my-home/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedHomes } from '../src/db/seed';
import { clearUserdata, createTestApp, injector } from './helpers';
import { testSeedFiles } from './fixtures';

const url = '/api/homes/mock-home/placements';

// The mock home's kitchen: x 1.5…5, z -4…0.5, its back wall's face at z = -3.85 (30 cm wall
// on z = -4), the ceiling at 2.50. A 35 cm wall cabinet against it, turned 0, stands at
// z = -3.675; a 60 cm base cabinet at z = -3.55.
const WALL_CABINET_Z = -3.85 + 0.35 / 2;

describe('wall- and ceiling-mounted placements (#63)', () => {
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

  const post = (body: object) =>
    inject('POST', url, { levelId: 'souterrain', rotationY: 0, ...body });
  const place = async (body: object) => {
    const res = await post(body);
    expect(res.statusCode, res.body).toBe(201);
    return Placement.parse(res.json());
  };
  const patch = (p: Placement, body: object) =>
    inject('PATCH', `${url}/${p.id}`, { version: p.version, ...body });
  const uses = async () =>
    ListUsesResponse.parse((await inject('GET', '/api/homes/mock-home/uses')).json()).items;

  it('defaults the mounting and elevation from the type', async () => {
    const cabinet = await place({
      typeId: 'kitchen.wall-cabinet',
      position: { x: 3, z: WALL_CABINET_Z },
    });
    expect(cabinet).toMatchObject({
      mounting: 'wall',
      elevation: 1.33,
      roomId: 'souterrain-kitchen',
    });
    const light = await place({ typeId: 'fixture.downlight', position: { x: 3, z: -2 } });
    expect(light).toMatchObject({ mounting: 'ceiling', elevation: 0 });
    const microwave = await place({ typeId: 'appliance.microwave', position: { x: 4, z: -3.6 } });
    expect(microwave).toMatchObject({ mounting: 'floor', elevation: 0.9 });
    const bed = await place({ typeId: 'furniture.bed', position: { x: -3, z: 2.5 } });
    expect(bed).toMatchObject({ mounting: 'floor', elevation: 0 });
  });

  it('a wall cabinet above a base cabinet is fine: no problems for either', async () => {
    await place({ typeId: 'kitchen.base-cabinet', position: { x: 3, z: -3.55 } });
    await place({ typeId: 'kitchen.wall-cabinet', position: { x: 3, z: WALL_CABINET_Z } });
    await place({ typeId: 'fixture.downlight', position: { x: 3, z: -2 } });
    const placed = (await uses()).filter((u) => u.source === 'db');
    expect(placed.map((u) => [u.typeId, u.status, u.problems])).toEqual([
      ['kitchen.base-cabinet', 'ok', []],
      ['kitchen.wall-cabinet', 'ok', []],
      ['fixture.downlight', 'ok', []],
    ]);
  });

  it('rejects mountings the type does not have, an elevation under the ceiling and a piece above it', async () => {
    const wall = await post({
      typeId: 'fixture.downlight',
      position: { x: 3, z: -2 },
      mounting: 'wall',
    });
    expect(wall.statusCode).toBe(400);
    expect(wall.json().message).toBe('A downlight cannot be mounted on a wall');
    const raised = await post({
      typeId: 'fixture.downlight',
      position: { x: 3, z: -2 },
      elevation: 0.5,
    });
    expect(raised.statusCode).toBe(400);
    expect(
      (await post({ typeId: 'furniture.bed', position: { x: -3, z: 2.5 }, elevation: -1 }))
        .statusCode,
    ).toBe(400);
    const high = await post({
      typeId: 'kitchen.wall-cabinet',
      position: { x: 3, z: WALL_CABINET_Z },
      elevation: 2,
    });
    expect(high.statusCode).toBe(422);
    expect(high.json().message).toMatch(/reaches above the ceiling at 250\.0 cm/);
    // A wall cabinet may also stand on the floor.
    const floor = await place({
      typeId: 'kitchen.wall-cabinet',
      position: { x: 3, z: WALL_CABINET_Z },
      mounting: 'floor',
      elevation: 0,
    });
    expect(floor).toMatchObject({ mounting: 'floor', elevation: 0 });
    expect((await patch(floor, { mounting: 'ceiling' })).statusCode).toBe(400);
    expect((await patch(floor, { elevation: 2.2 })).statusCode).toBe(422);
  });

  it('moves, raises and undoes, with history texts', async () => {
    const cabinet = await place({
      typeId: 'kitchen.wall-cabinet',
      position: { x: 3, z: WALL_CABINET_Z },
    });
    const moved = Placement.parse(
      (await patch(cabinet, { position: { x: 4, z: WALL_CABINET_Z }, elevation: 1.45 })).json(),
    );
    expect(moved).toMatchObject({ version: 2, elevation: 1.45, position: { x: 4 } });
    const history = ListHistoryResponse.parse(
      (await inject('GET', `/api/homes/mock-home/uses/${cabinet.id}/history`)).json(),
    ).items;
    expect(history[0]!.changes.map((c) => c.text)).toEqual([
      'moved 1.0 m',
      'raised to 145.0 cm above the floor',
    ]);
    const undo = await inject(
      'POST',
      `/api/homes/mock-home/uses/${cabinet.id}/history/${history[0]!.id}/undo`,
    );
    expect(undo.statusCode, undo.body).toBe(200);
    UndoResponse.parse(undo.json());
    const [back] = (await inject('GET', url)).json().items;
    expect(back).toMatchObject({ elevation: 1.33, position: { x: 3 }, version: 3 });
    // The same elevation again writes nothing.
    const same = Placement.parse(
      (await patch({ ...back, version: 3 }, { elevation: 1.33 })).json(),
    );
    expect(same.version).toBe(3);
  });

  it('needs attention when its wall is gone or it hangs off the wall', async () => {
    const cabinet = await place({
      typeId: 'kitchen.wall-cabinet',
      position: { x: 3, z: WALL_CABINET_Z },
    });
    await patch(cabinet, { position: { x: 3, z: -2 } });
    const [use] = (await uses()).filter((u) => u.id === cabinet.id);
    expect(use).toMatchObject({
      status: 'needs-attention',
      problems: ['hangs on no wall (its wall is gone or moved)'],
    });
  });

  it('reads rows of an older api (without the columns filled) as on the floor at 0', async () => {
    await ctx.database.db.execute(sql`
      insert into userdata.placements (home_id, id, type_id, name, level_id, room_id, x, z, rotation_y)
      values ('mock-home', 'souterrain-bed-9', 'furniture.bed', 'Old bed', 'souterrain', null, -3, 2.5, 0)`);
    const [old] = (await inject('GET', url)).json().items;
    expect(old).toMatchObject({ id: 'souterrain-bed-9', mounting: 'floor', elevation: 0 });
  });
});
