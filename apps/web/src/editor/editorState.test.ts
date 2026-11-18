import { describe, expect, it } from 'vitest';
import { editorItem } from '../test/fixtures';
import {
  canRedo,
  canUndo,
  editorReducer,
  initialEditorState,
  type EditorAction,
} from './editorState';

const a = editorItem({ id: 'a' });
const b = editorItem({ id: 'b' });
const run = (actions: EditorAction[], state = initialEditorState()) =>
  actions.reduce(editorReducer, state);

describe('editorReducer', () => {
  it('records edits as undoable commands and keeps the selection valid', () => {
    const state = run([
      { type: 'edit', label: 'Place', items: [a], selectedId: 'a' },
      { type: 'edit', label: 'Duplicate', items: [a, b], selectedId: 'b' },
      { type: 'edit', label: 'Delete', items: [a] },
    ]);
    expect(state.items).toEqual([a]);
    expect(state.selectedId).toBeUndefined();
    expect(state.history.past.map((c) => c.label)).toEqual(['Place', 'Duplicate', 'Delete']);

    const undone = run([{ type: 'undo' }, { type: 'select', id: 'b' }], state);
    expect(undone.items).toEqual([a, b]);
    expect(undone.selectedId).toBe('b');
    expect(canRedo(undone)).toBe(true);
    expect(run([{ type: 'redo' }], undone).items).toEqual([a]);
  });

  it('turns a drag into one move command, and can cancel it', () => {
    const placed = run([{ type: 'edit', label: 'Place', items: [a] }]);
    const step = (x: number): EditorAction => ({
      type: 'dragMove',
      item: { ...a, position: { x, z: 0 } },
    });
    const dragged = run([{ type: 'dragStart', id: 'a' }, step(1), step(2), step(3)], placed);
    expect(canUndo(dragged)).toBe(false);
    const done = run([{ type: 'dragEnd' }], dragged);
    expect(done.selectedId).toBe('a');
    expect(done.items[0]?.position).toEqual({ x: 3, z: 0 });
    expect(done.history.past.map((c) => c.label)).toEqual(['Place', 'Move']);
    expect(run([{ type: 'undo' }], done).items).toEqual([a]);

    const cancelled = run([{ type: 'dragCancel' }], dragged);
    expect(cancelled.items).toEqual([a]);
    expect(cancelled.history.past).toHaveLength(1);
  });

  it('does not count a cancelled press that moved nothing as a change', () => {
    const placed = run([{ type: 'edit', label: 'Place', items: [a] }]);
    const held = run([{ type: 'dragStart', id: 'a' }, { type: 'dragCancel' }], placed);
    expect(held.drag).toBeUndefined();
    expect(held.items).toBe(placed.items);
    // Nothing to save: the revision is what autosave watches.
    expect(held.revision).toBe(placed.revision);
    expect(held.selectedId).toBe('a');
  });

  it('records nothing for a drag that does not move, or an edit that changes nothing', () => {
    const placed = run([{ type: 'edit', label: 'Place', items: [a] }]);
    const still = run([{ type: 'dragStart', id: 'a' }, { type: 'dragEnd' }], placed);
    expect(still.history.past).toHaveLength(1);
    expect(run([{ type: 'edit', label: 'Rotate', items: [a] }], placed)).toBe(placed);
  });

  it('bumps the revision on changes and resets on load', () => {
    const edited = run([
      { type: 'edit', label: 'Place', items: [a] },
      { type: 'select', id: 'a' },
    ]);
    expect(edited.revision).toBe(1);
    const loaded = run([{ type: 'load', items: [b] }], edited);
    expect(loaded).toEqual({ items: [b], history: { past: [], future: [] }, revision: 0 });
  });

  it('takes the server copy of an item without an undo entry (synced, refresh)', () => {
    const temp = editorItem({ id: 'new-1', name: '' });
    const placed = run([{ type: 'edit', label: 'Place', items: [a, temp], selectedId: 'new-1' }]);
    const stable = { ...temp, id: 'souterrain-bed-1', name: 'Bedroom · Bed' };
    const synced = run([{ type: 'synced', from: 'new-1', item: stable }], placed);
    expect(synced.items).toEqual([a, stable]);
    expect(synced.selectedId).toBe('souterrain-bed-1');
    expect(synced.history.past).toHaveLength(1);
    expect(synced.history.past[0]!.changes.map((c) => c.id)).toEqual(['a', 'souterrain-bed-1']);
    // Undo removes the stable id, redo brings it back under it.
    expect(run([{ type: 'undo' }], synced).items).toEqual([]);
    expect(run([{ type: 'undo' }, { type: 'redo' }], synced).items).toEqual([a, stable]);

    // A conflict reload: gone elsewhere.
    const gone = run([{ type: 'synced', from: 'souterrain-bed-1', item: undefined }], synced);
    expect(gone.items).toEqual([a]);
    expect(gone.selectedId).toBeUndefined();

    const refreshed = run(
      [
        { type: 'select', id: 'a' },
        { type: 'refresh', items: [a, b] },
      ],
      synced,
    );
    expect(refreshed).toMatchObject({ items: [a, b], selectedId: 'a', revision: 0 });
    expect(canUndo(refreshed)).toBe(false);
  });
});
