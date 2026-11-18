import { describe, expect, it } from 'vitest';
import { editorItem } from '../test/fixtures';
import { applyChanges, diff, emptyHistory, record, redo, remapId, undo } from './history';

const a = editorItem({ id: 'a' });
const b = editorItem({ id: 'b', typeId: 'furniture.sofa' });
const c = editorItem({ id: 'c', typeId: 'furniture.desk' });

describe('history', () => {
  it('diffs item lists into changes', () => {
    const moved = { ...b, position: { x: 1, z: 1 } };
    expect(diff('Edit', [a, b], [moved, c]).changes).toEqual([
      { id: 'a', before: a, index: 0 },
      { id: 'b', before: b, after: moved },
      { id: 'c', after: c },
    ]);
  });

  it('applies changes forwards and backwards, restoring order on undo', () => {
    const command = diff('Delete', [a, b, c], [a, c]);
    const after = applyChanges([a, b, c], command.changes, 'forward');
    expect(after).toEqual([a, c]);
    expect(applyChanges(after, command.changes, 'backward')).toEqual([a, b, c]);
  });

  it('undoes and redoes a sequence of commands', () => {
    let items = [a];
    let history = emptyHistory;
    const steps = [
      [a, b],
      [a, { ...b, rotationY: Math.PI / 2 }],
      [
        { ...a, position: { x: 0, z: 0 } },
        { ...b, rotationY: Math.PI / 2 },
      ],
    ];
    for (const next of steps) {
      history = record(history, diff('Step', items, next));
      items = next;
    }
    const states = [items];
    for (let i = 0; i < 3; i++) {
      const r = undo(history, items)!;
      ({ items, history } = r);
      states.push(items);
    }
    expect(states.at(-1)).toEqual([a]);
    expect(undo(history, items)).toBeUndefined();
    for (let i = 0; i < 3; i++) ({ items, history } = redo(history, items)!);
    expect(items).toEqual(steps[2]);
    expect(redo(history, items)).toBeUndefined();
  });

  it('clears redo on a new command, ignores empty commands and caps the stack', () => {
    let history = record(emptyHistory, diff('Place', [], [a]));
    history = undo(history, [a])!.history;
    expect(history.future).toHaveLength(1);
    history = record(history, diff('Place', [], [b]));
    expect(history.future).toEqual([]);
    expect(record(history, diff('Nothing', [a], [a]))).toBe(history);

    let capped = emptyHistory;
    for (let i = 0; i < 5; i++) capped = record(capped, diff(`${i}`, [], [a]), 3);
    expect(capped.past.map((c) => c.label)).toEqual(['2', '3', '4']);
  });

  it('remaps a temporary id in both stacks, with the server name, and leaves others alone', () => {
    const temp = editorItem({ id: 'new-1', name: '' });
    const moved = { ...temp, position: { x: 0, z: 0 } };
    let history = record(emptyHistory, diff('Place', [a], [a, temp]));
    history = record(history, diff('Move', [a, temp], [a, moved]));
    const undone = undo(history, [a, moved])!;
    const remapped = remapId(undone.history, 'new-1', 'souterrain-bed-1', 'Bedroom · Bed');

    expect(remapped.past[0]!.changes).toEqual([
      { id: 'souterrain-bed-1', after: { ...temp, id: 'souterrain-bed-1', name: 'Bedroom · Bed' } },
    ]);
    expect(remapped.future[0]!.changes[0]).toMatchObject({
      id: 'souterrain-bed-1',
      before: { id: 'souterrain-bed-1', name: 'Bedroom · Bed', position: temp.position },
      after: { id: 'souterrain-bed-1', name: 'Bedroom · Bed', position: { x: 0, z: 0 } },
    });
    // Pure: the input is unchanged; an unknown id changes nothing.
    expect(undone.history.past[0]!.changes[0]!.id).toBe('new-1');
    expect(remapId(history, 'zzz', 'y')).toEqual(history);
    // Undo after the remap removes the stable id.
    const items = [a, { ...temp, id: 'souterrain-bed-1', name: 'Bedroom · Bed' }];
    expect(undo(remapped, items)!.items).toEqual([a]);
  });

  it('fills a name only into snapshots without one: an older rename stays undoable', () => {
    const named = editorItem({ id: 'x', name: 'Old name' });
    const renamed = { ...named, name: 'New name' };
    const history = record(emptyHistory, diff('Rename', [named], [renamed]));
    expect(remapId(history, 'x', 'x', 'Server name')).toEqual(history);
  });
});
