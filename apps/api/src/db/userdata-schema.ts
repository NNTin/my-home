import type { ParamValues, UseState } from '@my-home/shared';
import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { isNotNull, isNull } from 'drizzle-orm';

/**
 * The `userdata` schema: what people change on a deployed environment, as opposed to what lives
 * in git (docs/userdata.md). Furniture placements, per-use parameter overrides of openings, the
 * history of every change (with its actor) and every furniture id ever issued.
 *
 * Like `media` it is kept apart from `public`, so the staging reset never touches it, and it has
 * hand-written, expand-only migrations in `userdata-migrations/` (not drizzle-kit's). Nothing here
 * references `public` by foreign key, and there are no CHECK constraints: enum values are
 * validated by the app, so adding one needs no migration.
 */
export const USERDATA_SCHEMA = 'userdata';
export const userdata = pgSchema(USERDATA_SCHEMA);

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/** Furniture uses (one set per home); `removedAt` puts one in the trash. */
export const placements = userdata.table(
  'placements',
  {
    homeId: text('home_id').notNull(),
    id: text('id').notNull(),
    typeId: text('type_id').notNull(),
    name: text('name').notNull(),
    levelId: text('level_id').notNull(),
    roomId: text('room_id'),
    x: doublePrecision('x').notNull(),
    z: doublePrecision('z').notNull(),
    rotationY: doublePrecision('rotation_y').notNull(),
    params: jsonb('params').$type<ParamValues>().notNull().default({}),
    version: integer('version').notNull().default(1),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    removedAt: timestamptz('removed_at'),
  },
  (t) => [
    primaryKey({ columns: [t.homeId, t.id] }),
    index('placements_home_active_idx').on(t.homeId).where(isNull(t.removedAt)),
    index('placements_type_idx').on(t.typeId),
  ],
);
export type PlacementRow = typeof placements.$inferSelect;

/** Basic-parameter overrides of a git use (opening, roof window, outbuilding opening, gate). */
export const openingOverrides = userdata.table(
  'opening_overrides',
  {
    homeId: text('home_id').notNull(),
    useId: text('use_id').notNull(),
    typeId: text('type_id').notNull(),
    params: jsonb('params').$type<ParamValues>().notNull().default({}),
    version: integer('version').notNull().default(1),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.homeId, t.useId] })],
);
export type OpeningOverrideRow = typeof openingOverrides.$inferSelect;

/** One row per change of a use; kept forever (a purged placement takes its rows with it). */
export const history = userdata.table(
  'history',
  {
    id: text('id').primaryKey(),
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
    homeId: text('home_id').notNull(),
    useId: text('use_id').notNull(),
    useKind: text('use_kind').notNull(),
    action: text('action').notNull(),
    actor: text('actor').notNull(),
    actorSource: text('actor_source').notNull(),
    actorName: text('actor_name'),
    at: timestamptz('at').notNull().defaultNow(),
    before: jsonb('before').$type<UseState | null>(),
    after: jsonb('after').$type<UseState | null>(),
    undoesId: text('undoes_id'),
  },
  (t) => [
    index('history_use_idx').on(t.homeId, t.useId, t.seq.desc()),
    uniqueIndex('history_undoes_idx').on(t.undoesId).where(isNotNull(t.undoesId)),
  ],
);
export type HistoryRow = typeof history.$inferSelect;

/** Every use id ever handed out, so an id is never reused (not even after a trash purge). */
export const issuedIds = userdata.table(
  'issued_ids',
  {
    homeId: text('home_id').notNull(),
    id: text('id').notNull(),
    issuedAt: timestamptz('issued_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.homeId, t.id] })],
);
