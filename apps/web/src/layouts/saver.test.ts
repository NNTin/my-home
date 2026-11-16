import type { Layout, UpdateLayoutBody } from '@my-home/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, LayoutConflictError } from '../api';
import { layoutItem } from '../test/fixtures';
import { draftStore } from './drafts';
import { LayoutSaver, type SaverState } from './saver';

const layout = (overrides: Partial<Layout> = {}): Layout => ({
  id: 'l1',
  homeId: 'mock-home',
  name: 'Default',
  schemaVersion: 1,
  version: 1,
  items: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

function setup(update?: (id: string, body: UpdateLayoutBody) => Promise<Layout>) {
  const states: SaverState[] = [];
  const server = { version: 1 };
  const updateMock = vi.fn(
    update ??
      (async (_id: string, body: UpdateLayoutBody) => {
        if (body.version !== server.version) throw new LayoutConflictError(server.version);
        server.version++;
        return layout({ name: body.name, items: body.items, version: server.version });
      }),
  );
  const drafts = draftStore();
  const saver = new LayoutSaver({
    update: updateMock,
    drafts,
    onChange: (s) => states.push(s),
    debounceMs: 500,
    retryMs: 2000,
  });
  return { saver, update: updateMock, drafts, states, server };
}

const a = layoutItem({ id: 'a' });
const b = layoutItem({ id: 'b' });

describe('LayoutSaver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('writes a draft at once and saves after the debounce, coalescing edits', async () => {
    const { saver, update, drafts } = setup();
    saver.open(layout());
    saver.edit({ name: 'Default', items: [a] });
    saver.edit({ name: 'Default', items: [a, b] });
    expect(drafts.read('l1')?.items).toEqual([a, b]);
    expect(saver.current.status).toBe('pending');
    expect(update).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('l1', { name: 'Default', items: [a, b], version: 1 });
    expect(saver.current).toMatchObject({ status: 'saved', version: 2 });
    expect(drafts.read('l1')).toBeUndefined();
  });

  it('ignores edits that change nothing', async () => {
    const { saver, update } = setup();
    saver.open(layout());
    saver.edit({ name: 'Default', items: [] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(update).not.toHaveBeenCalled();
  });

  it('saves edits made during a save afterwards, on the new version', async () => {
    let resolve!: () => void;
    const gate = new Promise<void>((r) => (resolve = r));
    let version = 1;
    const { saver, update, drafts } = setup(async (_id, body) => {
      if (version === 1) await gate;
      version++;
      return layout({ items: body.items, version });
    });
    saver.open(layout());
    saver.edit({ name: 'Default', items: [a] });
    await vi.advanceTimersByTimeAsync(500);
    saver.edit({ name: 'Default', items: [a, b] });
    resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(drafts.read('l1')).toMatchObject({ baseVersion: 2, items: [a, b] });
    await vi.advanceTimersByTimeAsync(500);
    expect(update).toHaveBeenLastCalledWith('l1', { name: 'Default', items: [a, b], version: 2 });
    expect(saver.current).toMatchObject({ status: 'saved', version: 3 });
  });

  it('keeps the draft and retries while offline', async () => {
    let online = false;
    const { saver, update, drafts } = setup(async (_id, body) => {
      if (!online) throw new TypeError('Failed to fetch');
      return layout({ items: body.items, version: 2 });
    });
    saver.open(layout());
    saver.edit({ name: 'Default', items: [a] });
    await vi.advanceTimersByTimeAsync(500);
    expect(saver.current).toMatchObject({ status: 'offline', error: 'Failed to fetch' });
    expect(drafts.read('l1')?.items).toEqual([a]);

    online = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(update).toHaveBeenCalledTimes(2);
    expect(saver.current.status).toBe('saved');
  });

  it('does not retry a rejected save, but saves again on the next edit', async () => {
    let reject = true;
    const { saver, update, drafts } = setup(async (_id, body) => {
      if (reject) throw new ApiRequestError('PUT /api/layouts/l1 failed: Invalid', 400, {});
      return layout({ items: body.items, version: 2 });
    });
    saver.open(layout());
    saver.edit({ name: 'Default', items: [a] });
    await vi.advanceTimersByTimeAsync(500);
    expect(saver.current.status).toBe('rejected');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(update).toHaveBeenCalledTimes(1);
    expect(drafts.read('l1')?.items).toEqual([a]);

    reject = false;
    saver.edit({ name: 'Default', items: [a, b] });
    await vi.advanceTimersByTimeAsync(500);
    expect(update).toHaveBeenCalledTimes(2);
    expect(saver.current.status).toBe('saved');
  });

  it('stops on a 409, keeps the draft, and can overwrite', async () => {
    const { saver, update, drafts, server } = setup();
    saver.open(layout());
    server.version = 5; // changed in another tab
    saver.edit({ name: 'Default', items: [a] });
    await vi.advanceTimersByTimeAsync(500);
    expect(saver.current).toMatchObject({ status: 'conflict', conflictVersion: 5 });

    // Further edits stay local until the user decides.
    saver.edit({ name: 'Default', items: [a, b] });
    await vi.advanceTimersByTimeAsync(5000);
    expect(update).toHaveBeenCalledTimes(1);
    expect(drafts.read('l1')?.items).toEqual([a, b]);

    await saver.overwrite();
    expect(update).toHaveBeenLastCalledWith('l1', { name: 'Default', items: [a, b], version: 5 });
    expect(saver.current).toMatchObject({ status: 'saved', version: 6 });
    expect(drafts.read('l1')).toBeUndefined();
  });

  it('restores an unsynced draft on open and saves it', async () => {
    const { saver, update, drafts } = setup();
    drafts.write({
      layoutId: 'l1',
      baseVersion: 1,
      name: 'Renamed',
      items: [a],
      savedAt: '2026-01-01T00:00:01.000Z',
    });
    expect(saver.open(layout())).toEqual({ name: 'Renamed', items: [a], restored: true });
    expect(saver.current).toMatchObject({ status: 'pending', restored: true });
    await vi.advanceTimersByTimeAsync(500);
    expect(update).toHaveBeenCalledWith('l1', { name: 'Renamed', items: [a], version: 1 });
    expect(saver.current).toMatchObject({ status: 'saved', restored: false });
  });

  it('flushes pending edits at once, and discards drafts of deleted layouts', async () => {
    const { saver, update, drafts } = setup();
    saver.open(layout());
    saver.edit({ name: 'Default', items: [a] });
    await saver.flush();
    expect(update).toHaveBeenCalledTimes(1);

    saver.edit({ name: 'Default', items: [a, b] });
    saver.discard('l1');
    await vi.advanceTimersByTimeAsync(1000);
    expect(update).toHaveBeenCalledTimes(1);
    expect(drafts.read('l1')).toBeUndefined();
  });
});
