import type { Bearing, ParamValues, PlacementMounting, UseState } from '@my-home/shared';
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
    /** `floor`, `wall` or `ceiling` (validated by the api; no CHECK constraint). */
    mounting: text('mounting').$type<PlacementMounting>().notNull().default('floor'),
    /** Height of the bottom above the level's floor; 0 under a ceiling. */
    elevation: doublePrecision('elevation').notNull().default(0),
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

/** Free-text notes on a type (`homeId` null) or a use; `deletedAt` is a soft delete. */
export const notes = userdata.table(
  'notes',
  {
    id: text('id').primaryKey(),
    homeId: text('home_id'),
    subjectKind: text('subject_kind').notNull(),
    subjectId: text('subject_id').notNull(),
    body: text('body').notNull(),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [index('notes_subject_idx').on(t.subjectKind, t.subjectId).where(isNull(t.deletedAt))],
);
export type NoteRow = typeof notes.$inferSelect;

/** Per-home settings on top of the git model (the magnetic declination); history `use_kind` home. */
export const homeSettings = userdata.table('home_settings', {
  homeId: text('home_id').primaryKey(),
  magneticDeclination: jsonb('magnetic_declination').$type<Bearing | null>(),
  version: integer('version').notNull().default(1),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});
export type HomeSettingsRow = typeof homeSettings.$inferSelect;

/**
 * One-time imports, one row per home and source (`layouts`: the named layouts → placements, #44;
 * the import was removed in #56, the rows stay as the record).
 */
export const imports = userdata.table(
  'imports',
  {
    homeId: text('home_id').notNull(),
    source: text('source').notNull(),
    at: timestamptz('at').notNull().defaultNow(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [primaryKey({ columns: [t.homeId, t.source] })],
);
export type ImportRow = typeof imports.$inferSelect;
