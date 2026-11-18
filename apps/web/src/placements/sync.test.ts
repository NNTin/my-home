import { afterEach, describe, expect, it, vi } from 'vitest';
import { placementsApi, type PlacementsApi } from '../api';
import type { EditorItem } from '../editor/item';
import { fakeApi } from '../test/fakeApi';
import { editorItem, testPlacement } from '../test/fixtures';
import { pendingOps, PlacementSync, toEditorItem, type OpStore, type PendingOp } from './sync';

const memoryOps = (): OpStore & { saved: PendingOp[] } => {
  const store = {
    saved: [] as PendingOp[],
    read: () => structuredClone(store.saved),
    write: (_: string, ops: PendingOp[]) => {
      store.saved = structuredClone(ops);
    },
  };
  return store;
};

const bed = testPlacement();
const chair = testPlacement({
  id: 'souterrain-chair-1',
  typeId: 'furniture.chair',
  name: 'Bedroom · Chair',
  position: { x: -2, z: 1.5 },
});

function setup(
  options: {
    placements?: (typeof bed)[];
    api?: PlacementsApi;
    ops?: ReturnType<typeof memoryOps>;
  } = {},
) {
  const server = fakeApi({ placements: options.placements ?? [bed, chair] });
  const synced: [string, EditorItem | undefined][] = [];
  const states: string[] = [];
  const ops = options.ops ?? memoryOps();
  const sync = new PlacementSync({
    homeId: 'mock-home',
    api: options.api ?? placementsApi,
    ops,
    retryMs: 20,
    onChange: (s) => states.push(s.status),
    onSynced: (from, item) => synced.push([from, item]),
  });
  const writes = () =>
    server.fetch.mock.calls
      .filter(([, init]) => (init?.method ?? 'GET') !== 'GET')
      .map(
        ([url, init]) => `${init!.method} ${url.replace('/api/homes/mock-home/placements', '')}`,
      );
  return { server, sync, synced, states, ops, writes };
}

afterEach(() => vi.unstubAllGlobals());

describe('PlacementSync', () => {
  it('turns a diff into calls: create, patch (changed fields only) and delete', async () => {
    const { server, sync, synced, writes, states } = setup();
    const items = sync.open([bed, chair]);
    expect(items).toEqual([toEditorItem(bed), toEditorItem(chair)]);

    const moved = { ...items[0]!, position: { x: -3.5, z: 2.5 }, params: { width: 1.8 } };
    const fresh = editorItem({ id: 'new-1', name: '', typeId: 'furniture.desk' });
    sync.edit([moved, fresh]); // the chair is gone
    await sync.flush();

    expect(writes()).toEqual([
      'PATCH /souterrain-bed-1',
      'POST ',
      'DELETE /souterrain-chair-1?version=1',
    ]);
    const patch = server.calls('PATCH', /bed-1/)[0]![1]!.body as string;
    expect(JSON.parse(patch)).toEqual({
      version: 1,
      position: { x: -3.5, z: 2.5 },
      params: { width: 1.8 },
    });
    // The server's id and name come back to the editor.
    expect(synced).toEqual([
      ['new-1', { ...fresh, id: 'souterrain-desk-1', name: 'Bedroom · Desk' }],
    ]);
    expect(server.placements.get('souterrain-chair-1')?.removedAt).not.toBeNull();
    expect(sync.current.status).toBe('saved');
    expect(states).toContain('saving');

    // Edits under the temporary id (made before the remap reached the editor) go to the stable one.
    sync.edit([moved, { ...fresh, rotationY: 1 }]);
    await sync.flush();
    expect(writes().at(-1)).toBe('PATCH /souterrain-desk-1');
    expect(sync.idle).toBe(true);
  });

  it('restores an item that comes back (an undone delete) instead of creating it again', async () => {
    const { sync, writes } = setup();
    const items = sync.open([bed, chair]);
    sync.edit([items[0]!]);
    await sync.flush();
    sync.edit(items); // undo
    await sync.flush();
    expect(writes()).toEqual([
      'DELETE /souterrain-chair-1?version=1',
      'POST /souterrain-chair-1/restore',
    ]);
    expect(sync.current.status).toBe('saved');
  });

  it('runs one call at a time; later edits of the same item follow with the new version', async () => {
    let inFlight = 0;
    let most = 0;
    const slow =
      <A extends unknown[], R>(f: (...a: A) => Promise<R>) =>
      async (...a: A) => {
        most = Math.max(most, ++inFlight);
        await new Promise((r) => setTimeout(r, 5));
        try {
          return await f(...a);
        } finally {
          inFlight--;
        }
      };
    const api = {
      ...placementsApi,
      update: slow(placementsApi.update),
      create: slow(placementsApi.create),
    };
    const { sync, writes, server } = setup({ api });
    const [b] = sync.open([bed, chair]);
    sync.edit([{ ...b!, rotationY: 1 }, toEditorItem(chair)]);
    await new Promise((r) => setTimeout(r, 1)); // the first PATCH is on its way
    sync.edit([{ ...b!, rotationY: 2 }, toEditorItem(chair)]);
    // Edits made before a call starts are sent together: the latest state.
    sync.edit([
      { ...b!, rotationY: 3 },
      { ...toEditorItem(chair), rotationY: 1 },
    ]);
    await sync.flush();
    expect(most).toBe(1);
    expect(writes()).toEqual([
      'PATCH /souterrain-bed-1',
      'PATCH /souterrain-bed-1',
      'PATCH /souterrain-chair-1',
    ]);
    expect(
      server.calls('PATCH', /bed-1/).map(([, init]) => JSON.parse(init!.body as string)),
    ).toEqual([
      { version: 1, rotationY: 1 },
      { version: 2, rotationY: 3 },
    ]);
    expect(server.placements.get('souterrain-bed-1')).toMatchObject({ rotationY: 3, version: 3 });
  });

  it('retries after a 5xx or a lost connection, and is offline meanwhile', async () => {
    const { sync, server } = setup();
    const [b, c] = sync.open([bed, chair]);
    const realFetch = server.fetch.getMockImplementation()!;
    server.fetch.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ statusCode: 503, error: 'x', message: 'down' }), {
          status: 503,
        }),
    );
    sync.edit([{ ...b!, rotationY: 1 }, c!]);
    await sync.flush();
    expect(sync.current).toMatchObject({ status: 'offline' });
    expect(sync.current.error).toMatch(/down/);
    server.fetch.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')));
    await vi.waitFor(() => expect(server.fetch.mock.calls.length).toBeGreaterThan(1));
    server.fetch.mockImplementation(realFetch);
    await vi.waitFor(() => expect(sync.current.status).toBe('saved'));
    expect(server.placements.get('souterrain-bed-1')?.rotationY).toBe(1);
  });

  it('keeps pending changes for a reload and replays them on the server copy', async () => {
    const ops = memoryOps();
    const first = setup({ ops });
    first.server.fetch.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const [b] = first.sync.open([bed, chair]);
    const fresh = editorItem({ id: 'new-1', name: '', typeId: 'furniture.desk' });
    first.sync.edit([{ ...b!, rotationY: 1 }, fresh]); // and the chair deleted
    await first.sync.flush();
    first.sync.close();
    expect(ops.saved.map((o) => `${o.op} ${o.id}`)).toEqual([
      'update souterrain-bed-1',
      'create new-1',
      'delete souterrain-chair-1',
    ]);

    // "Reload": a new sync with the same storage, the server unchanged.
    const second = setup({ ops });
    const shown = second.sync.open([bed, chair]);
    expect(shown.map((i) => [i.id, i.rotationY])).toEqual([
      ['souterrain-bed-1', 1],
      ['new-1', 0],
    ]);
    expect(second.sync.current.restored).toBe(true);
    await vi.waitFor(() => expect(second.sync.current.status).toBe('saved'));
    expect(second.writes()).toEqual([
      'PATCH /souterrain-bed-1',
      'POST ',
      'DELETE /souterrain-chair-1?version=1',
    ]);
    expect(ops.saved).toEqual([]);
  });

  it('drops a replayed change to an item that was changed elsewhere meanwhile', () => {
    const ops = memoryOps();
    ops.saved = [
      { op: 'update', id: bed.id, item: { ...toEditorItem(bed), rotationY: 1 }, baseVersion: 1 },
    ];
    const { sync } = setup({ ops });
    const shown = sync.open([{ ...bed, version: 2, rotationY: 2 }]);
    expect(shown[0]?.rotationY).toBe(2);
    expect(sync.current).toMatchObject({ status: 'conflict', changedElsewhere: ['Bedroom · Bed'] });
  });

  it('reloads the item on a 409 and reports "changed elsewhere"', async () => {
    const { server, sync, synced } = setup();
    const [b, c] = sync.open([bed, chair]);
    server.touch(bed.id, { rotationY: 2 }); // an agent turned it
    sync.edit([{ ...b!, position: { x: -3.2, z: 2.5 } }, c!]);
    await sync.flush();
    expect(synced).toEqual([[bed.id, { ...toEditorItem(bed), rotationY: 2 }]]);
    expect(sync.current).toMatchObject({ status: 'conflict', changedElsewhere: ['Bedroom · Bed'] });
    expect(server.placements.get(bed.id)).toMatchObject({ rotationY: 2, version: 2 });

    // The next edit is saved on the new version and ends the conflict.
    sync.edit([{ ...b!, rotationY: 2, position: { x: -3.2, z: 2.5 } }, c!]);
    await sync.flush();
    expect(server.placements.get(bed.id)).toMatchObject({
      position: { x: -3.2, z: 2.5 },
      version: 3,
    });
    expect(sync.current.status).toBe('saved');
  });

  it('marks a refused change rejected and does not retry it until it changes', async () => {
    const { server, sync, writes } = setup();
    const [b, c] = sync.open([bed, chair]);
    const realFetch = server.fetch.getMockImplementation()!;
    server.fetch.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ statusCode: 422, error: 'x', message: 'too wide' }), {
          status: 422,
        }),
    );
    sync.edit([{ ...b!, params: { width: 2.2 } }, c!]);
    await sync.flush();
    expect(sync.current).toMatchObject({
      status: 'rejected',
      error: expect.stringMatching(/too wide/),
    });
    server.fetch.mockImplementation(realFetch);
    sync.edit([{ ...b!, params: { width: 2.2 } }, { ...c! }]);
    await sync.flush();
    expect(writes()).toHaveLength(1);
    sync.edit([{ ...b!, params: { width: 2 } }, c!]);
    await sync.flush();
    expect(sync.current.status).toBe('saved');
  });

  it('takes the server copy when it stores a value differently, instead of patching forever', async () => {
    const api = {
      ...placementsApi,
      update: async (...a: Parameters<PlacementsApi['update']>) => {
        const saved = await placementsApi.update(...a);
        return { ...saved, params: { color: '#aabbcc' } };
      },
    };
    const { sync, synced, writes } = setup({ api });
    const [b, c] = sync.open([bed, chair]);
    sync.edit([{ ...b!, params: { color: '#AABBCC' } }, c!]);
    await sync.flush();
    expect(writes()).toEqual(['PATCH /souterrain-bed-1']);
    expect(synced.at(-1)?.[1]?.params).toEqual({ color: '#aabbcc' });
    expect(sync.current.status).toBe('saved');
  });

  it('lists pending ops from the known and the desired items', () => {
    const k = new Map([[bed.id, { item: toEditorItem(bed), version: 4, removed: false }]]);
    expect(pendingOps(k, new Map([[bed.id, toEditorItem(bed)]]))).toEqual([]);
    // Key order of params does not matter (jsonb reorders them).
    const a = { ...toEditorItem(bed), params: { width: 1.8, color: '#112233' } };
    const b = { ...a, params: { color: '#112233', width: 1.8 } };
    const known = new Map([[bed.id, { item: a, version: 1, removed: false }]]);
    expect(pendingOps(known, new Map([[bed.id, b]]))).toEqual([]);
    expect(pendingOps(k, new Map())).toEqual([{ op: 'delete', id: bed.id, baseVersion: 4 }]);
  });
});
