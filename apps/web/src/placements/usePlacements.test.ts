import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../test/fakeApi';
import { editorItem, testPlacement } from '../test/fixtures';
import type { OpStore, PendingOp } from './sync';
import { usePlacements } from './usePlacements';

const memoryOps = (saved: PendingOp[] = []): OpStore => ({
  read: () => saved,
  write: (_, ops) => {
    saved = ops;
  },
});

let ops = memoryOps();
beforeEach(() => {
  ops = memoryOps();
});
afterEach(() => vi.unstubAllGlobals());

describe('usePlacements', () => {
  it('loads the placements (not the trashed ones) into the editor', async () => {
    fakeApi({
      placements: [
        testPlacement(),
        testPlacement({ id: 'souterrain-bed-2', removedAt: '2026-01-02T00:00:00.000Z' }),
      ],
    });
    const { result } = renderHook(() => usePlacements('mock-home', 0, undefined, ops));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.editor.items.map((i) => i.id)).toEqual(['souterrain-bed-1']);
    expect(result.current.editor.items[0]).toMatchObject({
      name: 'Bedroom · Bed',
      roomId: 'souterrain-bedroom',
    });
    expect(result.current.syncState.status).toBe('saved');
  });

  it('saves an edit and takes the stable id and name the server gives a new item', async () => {
    const api = fakeApi();
    const { result } = renderHook(() => usePlacements('mock-home', 0, undefined, ops));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const temp = editorItem({ id: 'new-1', name: '' });
    act(() =>
      result.current.dispatch({ type: 'edit', label: 'Place', items: [temp], selectedId: 'new-1' }),
    );
    await waitFor(() => expect(result.current.editor.items[0]?.id).toBe('souterrain-bed-1'));
    expect(result.current.editor.items[0]?.name).toBe('Bedroom · Bed');
    expect(result.current.editor.selectedId).toBe('souterrain-bed-1');
    expect(api.placements.size).toBe(1);

    // Undo deletes it (to the trash), redo restores it: no second create.
    act(() => result.current.dispatch({ type: 'undo' }));
    await waitFor(() => expect(api.placements.get('souterrain-bed-1')?.removedAt).not.toBeNull());
    act(() => result.current.dispatch({ type: 'redo' }));
    await waitFor(() => expect(api.placements.get('souterrain-bed-1')?.removedAt).toBeNull());
    expect(api.calls('POST', /\/placements$/)).toHaveLength(1);
    await waitFor(() => expect(result.current.syncState.status).toBe('saved'));
  });

  it('does not save during a drag, only when it ends', async () => {
    const api = fakeApi({ placements: [testPlacement()] });
    const { result } = renderHook(() => usePlacements('mock-home', 0, undefined, ops));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const bed = result.current.editor.items[0]!;
    act(() => result.current.dispatch({ type: 'dragStart', id: bed.id }));
    act(() =>
      result.current.dispatch({
        type: 'dragMove',
        item: { ...bed, position: { x: -3.2, z: 2.5 } },
      }),
    );
    act(() =>
      result.current.dispatch({
        type: 'dragMove',
        item: { ...bed, position: { x: -3.4, z: 2.5 } },
      }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(api.calls('PATCH', /placements/)).toHaveLength(0);
    act(() => result.current.dispatch({ type: 'dragEnd' }));
    await waitFor(() => expect(api.calls('PATCH', /placements/)).toHaveLength(1));
    expect(api.placements.get(bed.id)?.position).toEqual({ x: -3.4, z: 2.5 });
  });

  it('reloads when the tab is visible again and nothing is pending (an agent moved it)', async () => {
    const api = fakeApi({ placements: [testPlacement()] });
    const { result, rerender } = renderHook(
      ({ visible }) => usePlacements('mock-home', visible, undefined, ops),
      { initialProps: { visible: 0 } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    api.touch('souterrain-bed-1', { position: { x: -2, z: 2 } });
    rerender({ visible: 1 });
    await waitFor(() => expect(result.current.editor.items[0]?.position).toEqual({ x: -2, z: 2 }));
    expect(api.calls('PATCH', /placements/)).toHaveLength(0);
  });

  it('reports a failed load', async () => {
    const api = fakeApi();
    api.fetch.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const { result } = renderHook(() => usePlacements('mock-home', 0, undefined, ops));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/Loading the furniture failed/);
  });
});
