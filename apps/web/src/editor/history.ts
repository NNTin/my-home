import type { LayoutItem } from '@my-home/shared';

/**
 * Undo/redo as a stack of reversible commands. A command lists per-item changes (`before`
 * missing = added, `after` missing = removed), so one implementation covers place, move, rotate,
 * delete and duplicate.
 */

export interface Change {
  id: string;
  before?: LayoutItem;
  after?: LayoutItem;
  /** Position in the list before the change, so undoing a delete restores the order. */
  index?: number;
}

export interface Command {
  label: string;
  changes: Change[];
}

export interface History {
  past: Command[];
  future: Command[];
}

export const emptyHistory: History = { past: [], future: [] };
export const HISTORY_LIMIT = 200;

/** Applies a command's changes forwards (`after`) or backwards (`before`). */
export function applyChanges(
  items: LayoutItem[],
  changes: Change[],
  direction: 'forward' | 'backward',
): LayoutItem[] {
  let next = items;
  const ordered = direction === 'forward' ? changes : [...changes].reverse();
  for (const change of ordered) {
    const target = direction === 'forward' ? change.after : change.before;
    const at = next.findIndex((i) => i.id === change.id);
    if (!target) {
      if (at >= 0) next = next.filter((_, i) => i !== at);
    } else if (at >= 0) {
      next = next.map((item, i) => (i === at ? target : item));
    } else {
      const index = direction === 'backward' ? (change.index ?? next.length) : next.length;
      next = [...next.slice(0, index), target, ...next.slice(index)];
    }
  }
  return next;
}

/** Builds a command from item lists, recording only items that actually changed. */
export function diff(label: string, before: LayoutItem[], after: LayoutItem[]): Command {
  const changes: Change[] = [];
  const afterById = new Map(after.map((i) => [i.id, i]));
  const beforeIds = new Set(before.map((i) => i.id));
  before.forEach((item, index) => {
    const next = afterById.get(item.id);
    if (!next) changes.push({ id: item.id, before: item, index });
    else if (JSON.stringify(next) !== JSON.stringify(item))
      changes.push({ id: item.id, before: item, after: next });
  });
  for (const item of after) if (!beforeIds.has(item.id)) changes.push({ id: item.id, after: item });
  return { label, changes };
}

/** Records a command that has already been applied; clears the redo stack. */
export function record(history: History, command: Command, limit = HISTORY_LIMIT): History {
  if (command.changes.length === 0) return history;
  return { past: [...history.past, command].slice(-limit), future: [] };
}

export function undo(history: History, items: LayoutItem[]) {
  const command = history.past.at(-1);
  if (!command) return undefined;
  return {
    command,
    items: applyChanges(items, command.changes, 'backward'),
    history: { past: history.past.slice(0, -1), future: [...history.future, command] },
  };
}

export function redo(history: History, items: LayoutItem[]) {
  const command = history.future.at(-1);
  if (!command) return undefined;
  return {
    command,
    items: applyChanges(items, command.changes, 'forward'),
    history: { past: [...history.past, command], future: history.future.slice(0, -1) },
  };
}
