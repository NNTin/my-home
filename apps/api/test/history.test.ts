import {
  catalog,
  describeChanges,
  HistoryEntry,
  ListHistoryResponse,
  Placement,
  UndoResponse,
  UseConflict,
} from '@my-home/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedHomes } from '../src/db/seed';
import { clearUserdata, createTestApp, injector } from './helpers';
import { testSeedFiles } from './fixtures';

const home = '/api/homes/mock-home';
const agent = { 'X-My-Home-Actor': 'agent' };

describe('describeChanges', () => {
  const bed = catalog.get('furniture.bed')!;
  const window = catalog.get('window.casement')!;
  const state = {
    name: 'Bed',
    params: {},
    levelId: 'souterrain',
    roomId: 'souterrain-bedroom',
    position: { x: 0, z: 0 },
    rotationY: 0,
    removed: false,
  };

  it('describes each changed field', () => {
    expect(
      describeChanges(
        bed,
        state,
        {
          ...state,
          name: 'Guest bed',
          params: { width: 1.8, color: '#AABBCC' },
          roomId: 'souterrain-kitchen',
          position: { x: 0.6, z: 0.8 },
          rotationY: Math.PI / 2,
        },
        { roomName: 'Kitchen' },
      ),
    ).toEqual([
      { field: 'name', text: "renamed 'Bed' → 'Guest bed'" },
      { field: 'position', text: 'moved 1.0 m' },
      { field: 'roomId', text: 'moved to Kitchen' },
      { field: 'rotationY', text: 'rotated 90°' },
      { field: 'params.color', text: 'colour #8a6a4a → #aabbcc' },
      { field: 'params.width', text: 'width 160.0 cm → 180.0 cm' },
    ]);
    expect(
      describeChanges(
        window,
        { params: { sashes: 2, frameColor: '#383e42' } },
        { params: { sashes: 2 } },
      ),
    ).toEqual([{ field: 'params.frameColor', text: 'frame colour #383e42 → #f7f7f5 (default)' }]);
    expect(describeChanges(bed, state, { ...state, removed: true })).toEqual([
      { field: 'removed', text: 'moved to the trash' },
    ]);
    expect(describeChanges(bed, null, state, { roomName: 'Bedroom' })).toEqual([
      { field: 'created', text: 'placed in Bedroom' },
    ]);
    expect(describeChanges(bed, state, { ...state, rotationY: -Math.PI / 2 })).toEqual([
      { field: 'rotationY', text: 'rotated -90°' },
    ]);
  });
});

describe('history and undo', () => {
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

  const historyRows = async () =>
    (
      (await ctx.database.db.execute(
        sql`select count(*)::int as n from userdata.history`,
      )) as unknown as {
        rows: { n: number }[];
      }
    ).rows[0]!.n;
  const historyOf = async (useId: string) =>
    ListHistoryResponse.parse((await inject('GET', `${home}/uses/${useId}/history`)).json()).items;
  const undo = (useId: string, entryId: string, headers = agent) =>
    inject('POST', `${home}/uses/${useId}/history/${entryId}/undo`, undefined, headers);
  const place = async () =>
    Placement.parse(
      (
        await inject(
          'POST',
          `${home}/placements`,
          { typeId: 'furniture.bed', levelId: 'souterrain', position: { x: -3, z: 2.5 } },
          agent,
        )
      ).json(),
    );
  const patch = (id: string, body: object) =>
    inject('PATCH', `${home}/placements/${id}`, body, { 'X-Authentik-Username': 'the-owner' });

  it('records exactly one row per write, with the actor', async () => {
    const bed = await place();
    expect(await historyRows()).toBe(1);
    await patch(bed.id, { version: 1, params: { width: 1.8 } });
    expect(await historyRows()).toBe(2);
    await inject('DELETE', `${home}/placements/${bed.id}?version=2`);
    await inject('POST', `${home}/placements/${bed.id}/restore`);
    await inject('PUT', `${home}/opening-overrides/souterrain-kitchen-window`, {
      version: 0,
      params: { sashes: 2 },
    });
    expect(await historyRows()).toBe(5);
    // Rejected writes and no-op patches record nothing.
    await patch(bed.id, { version: 1, name: 'stale' });
    await patch(bed.id, { version: 4, params: { width: 1.8 } });
    expect(await historyRows()).toBe(5);

    const entries = await historyOf(bed.id);
    expect(entries.map((e) => [e.action, e.actor, e.actorSource, e.actorName])).toEqual([
      ['restore', 'owner', 'default', null],
      ['remove', 'owner', 'default', null],
      ['update', 'owner', 'identity', 'the-owner'],
      ['create', 'agent', 'declared', null],
    ]);
    expect(entries.map((e) => e.changes.map((c) => c.text))).toEqual([
      ['restored'],
      ['moved to the trash'],
      ['width 160.0 cm → 180.0 cm'],
      ['placed in Bedroom'],
    ]);
    expect(entries.map((e) => e.canUndo)).toEqual([true, false, true, true]);
    const [opening] = await historyOf('souterrain-kitchen-window');
    expect(opening).toMatchObject({
      useKind: 'opening',
      action: 'update',
      before: { params: {} },
      after: { params: { sashes: 2 } },
    });
    expect((await inject('GET', '/api/homes/nope/uses/x/history')).statusCode).toBe(404);
    expect((await inject('GET', `${home}/uses/nope/history`)).statusCode).toBe(404);
    // A git use without any change yet has an empty history.
    expect(await historyOf('souterrain-bedroom-window')).toEqual([]);
  });

  it('undoes an update field by field, records the undo and refuses a second one', async () => {
    const bed = await place();
    await patch(bed.id, { version: 1, params: { width: 1.8 } });
    await patch(bed.id, { version: 2, name: 'Guest bed' });
    const [rename, resize] = await historyOf(bed.id);
    expect(resize!.canUndo).toBe(true); // the rename touched another field

    const res = await undo(bed.id, resize!.id);
    expect(res.statusCode, res.body).toBe(200);
    const { entry, use } = UndoResponse.parse(res.json());
    expect(entry).toMatchObject({
      action: 'undo',
      undoesId: resize!.id,
      actor: 'agent',
      canUndo: true,
    });
    expect(entry.changes.map((c) => c.text)).toEqual(['width 180.0 cm → 160.0 cm (default)']);
    expect(use).toMatchObject({ id: bed.id, name: 'Guest bed', overrides: {}, version: 4 });

    const twice = await undo(bed.id, resize!.id);
    expect(twice.statusCode).toBe(409);
    expect(UseConflict.parse(twice.json()).conflicts).toEqual(['already undone']);
    const after = await historyOf(bed.id);
    expect(after.find((e) => e.id === resize!.id)).toMatchObject({
      undoneById: entry.id,
      canUndo: false,
    });
    expect(after.find((e) => e.id === rename!.id)!.canUndo).toBe(true);
  });

  it('refuses an undo when a field changed again later (409)', async () => {
    const bed = await place();
    await patch(bed.id, { version: 1, params: { width: 1.8 } });
    await patch(bed.id, { version: 2, params: { width: 2.0 } });
    const [, first] = await historyOf(bed.id);
    expect(first!.canUndo).toBe(false);
    const res = await undo(bed.id, first!.id);
    expect(res.statusCode).toBe(409);
    expect(UseConflict.parse(res.json())).toMatchObject({
      currentVersion: 3,
      conflicts: ['width changed again later: undo the later change first'],
    });
  });

  it('undoing a create removes, undoing a remove restores, undoing an undo redoes', async () => {
    const bed = await place();
    const [create] = await historyOf(bed.id);
    const removed = UndoResponse.parse((await undo(bed.id, create!.id)).json());
    expect(removed.use.removedAt).not.toBeNull();
    expect(removed.entry.changes.map((c) => c.text)).toEqual(['moved to the trash']);

    // Undo the undo: back out of the trash.
    const redone = UndoResponse.parse((await undo(bed.id, removed.entry.id)).json());
    expect(redone.use.removedAt).toBeNull();

    await inject('DELETE', `${home}/placements/${bed.id}?version=${redone.use.version}`);
    const [remove] = await historyOf(bed.id);
    expect(remove!.action).toBe('remove');
    const restored = UndoResponse.parse((await undo(bed.id, remove!.id)).json());
    expect(restored.use.removedAt).toBeNull();
    expect(restored.entry.changes.map((c) => c.text)).toEqual(['restored']);
  });

  it('undoes an opening override', async () => {
    const put = (version: number, params: object) =>
      inject('PUT', `${home}/opening-overrides/souterrain-kitchen-window`, { version, params });
    await put(0, { frameColor: '#383e42' });
    await put(1, { frameColor: '#383e42', sashes: 2 });
    const [sashes] = await historyOf('souterrain-kitchen-window');
    const { use } = UndoResponse.parse(
      (await undo('souterrain-kitchen-window', sashes!.id)).json(),
    );
    expect(use).toMatchObject({ overrides: { frameColor: '#383e42' }, version: 3 });
    expect(
      (await undo('souterrain-kitchen-window', '00000000-0000-4000-8000-000000000000')).statusCode,
    ).toBe(404);
  });

  it('the unique index rejects a second undo row for one entry', async () => {
    const bed = await place();
    const [create] = await historyOf(bed.id);
    await undo(bed.id, create!.id);
    const insert = () =>
      ctx.database.db.execute(sql`insert into userdata.history
        (id, home_id, use_id, use_kind, action, actor, actor_source, undoes_id)
        values (gen_random_uuid()::text, 'mock-home', ${bed.id}, 'placement', 'undo', 'owner', 'default', ${create!.id})`);
    await expect(insert()).rejects.toThrow();
    expect(HistoryEntry.array().parse(await historyOf(bed.id))).toHaveLength(2);
  });
});
