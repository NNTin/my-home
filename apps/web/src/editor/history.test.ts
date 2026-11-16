import { describe, expect, it } from 'vitest';
import { layoutItem } from '../test/fixtures';
import { applyChanges, diff, emptyHistory, record, redo, undo } from './history';

const a = layoutItem({ id: 'a' });
const b = layoutItem({ id: 'b', typeId: 'sofa' });
const c = layoutItem({ id: 'c', typeId: 'desk' });

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
});
