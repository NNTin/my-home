import { randomUUID } from 'node:crypto';
import {
  describeChanges,
  type CatalogType,
  type HistoryAction,
  type HistoryEntry,
  type UseKind,
  type UseState,
} from '@my-home/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { ResolvedActor } from '../actor';
import type { Db } from './client';
import { history, type HistoryRow } from './userdata-schema';

/** Who a history row is recorded for; `system` is the release job and imports. */
export type HistoryActor = ResolvedActor | { actor: 'system'; source: 'default'; username: null };

/** A transaction or the database: history rows are written in the same transaction as the change. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface RecordInput {
  homeId: string;
  useId: string;
  useKind: UseKind;
  action: HistoryAction;
  actor: HistoryActor;
  before: UseState | null;
  after: UseState | null;
  undoesId?: string | null;
}

/** Writes one history row; call it inside the transaction of the change it records. */
export async function recordHistory(tx: Tx | Db, input: RecordInput): Promise<HistoryRow> {
  const [row] = await tx
    .insert(history)
    .values({
      id: randomUUID(),
      homeId: input.homeId,
      useId: input.useId,
      useKind: input.useKind,
      action: input.action,
      actor: input.actor.actor,
      actorSource: input.actor.source,
      actorName: input.actor.username,
      before: input.before,
      after: input.after,
      undoesId: input.undoesId ?? null,
    })
    .returning();
  return row!;
}

/** Every history row of a use, newest first. */
export const listHistoryRows = (db: Db | Tx, homeId: string, useId: string) =>
  db
    .select()
    .from(history)
    .where(and(eq(history.homeId, homeId), eq(history.useId, useId)))
    .orderBy(desc(history.seq));

// Undo: a field-level revert.

type Value = UseState[keyof UseState] | string | number | undefined;

const SCALAR_FIELDS = ['name', 'levelId', 'roomId', 'position', 'rotationY', 'removed'] as const;

const read = (state: UseState, field: string): Value => {
  if (field.startsWith('params.')) return state.params[field.slice('params.'.length)];
  return state[field as (typeof SCALAR_FIELDS)[number]];
};

const same = (a: Value, b: Value) => JSON.stringify(a) === JSON.stringify(b);

/** The state an undo starts from for a creation: the same use, removed. */
const beforeOf = (entry: Pick<HistoryRow, 'before' | 'after'>): UseState | null =>
  entry.before ?? (entry.after ? { ...entry.after, removed: true } : null);

/** The fields an entry changed: scalar fields and `params.<key>` per parameter. */
export function changedFields(before: UseState, after: UseState): string[] {
  const fields: string[] = SCALAR_FIELDS.filter(
    (f) => after[f] !== undefined && !same(before[f], after[f]),
  );
  const keys = new Set([...Object.keys(before.params), ...Object.keys(after.params)]);
  for (const key of keys) {
    if (!same(before.params[key], after.params[key])) fields.push(`params.${key}`);
  }
  return fields;
}

export interface UndoPlan {
  /** The fields to set back. */
  fields: string[];
  /** Fields changed again after the entry; the undo is refused while there are any. */
  conflicts: string[];
  /** The use's state after the undo. */
  target: UseState;
}

/**
 * How to undo `entry` from the use's `current` state: each field the entry changed goes back to
 * its `before` value, but only if it still has the entry's `after` value. Undoing a creation
 * removes the use (into the trash); undoing a removal restores it; undoing an undo redoes.
 */
export function undoPlan(entry: Pick<HistoryRow, 'before' | 'after'>, current: UseState): UndoPlan {
  const before = beforeOf(entry);
  const after = entry.after;
  if (!before || !after) return { fields: [], conflicts: [], target: current };
  const fields = changedFields(before, after);
  const conflicts = fields.filter((f) => !same(read(current, f), read(after, f)));
  const target: UseState = { ...current, params: { ...current.params } };
  for (const field of fields) {
    const value = read(before, field);
    if (field.startsWith('params.')) {
      const key = field.slice('params.'.length);
      if (value === undefined) delete target.params[key];
      else target.params[key] = value as string | number;
    } else {
      (target as Record<string, unknown>)[field] = value;
    }
  }
  return { fields, conflicts, target };
}

export const conflictText = (field: string) =>
  `${field.replace(/^params\./, '')} changed again later: undo the later change first`;

export interface EntryContext {
  type: CatalogType | undefined;
  /** The use's current state (undefined when it no longer exists). */
  current: UseState | undefined;
  undoneById: string | null;
  roomName?: (roomId: string) => string | undefined;
  levelName?: (levelId: string) => string | undefined;
}

/** A history row as the api returns it, with its description and whether it can be undone now. */
export function toHistoryEntry(row: HistoryRow, ctx: EntryContext): HistoryEntry {
  const plan = ctx.current ? undoPlan(row, ctx.current) : undefined;
  const after = row.after;
  return {
    id: row.id,
    homeId: row.homeId,
    useId: row.useId,
    useKind: row.useKind as UseKind,
    action: row.action as HistoryAction,
    actor: row.actor as HistoryEntry['actor'],
    actorSource: row.actorSource as HistoryEntry['actorSource'],
    actorName: row.actorName,
    at: row.at.toISOString(),
    before: row.before ?? null,
    after: after ?? null,
    changes: describeChanges(ctx.type, row.before ?? null, after ?? null, {
      ...(after?.roomId && { roomName: ctx.roomName?.(after.roomId) }),
      ...(after?.levelId && { levelName: ctx.levelName?.(after.levelId) }),
    }),
    undoesId: row.undoesId,
    undoneById: ctx.undoneById,
    canUndo:
      ctx.undoneById === null &&
      plan !== undefined &&
      plan.fields.length > 0 &&
      plan.conflicts.length === 0,
  };
}
