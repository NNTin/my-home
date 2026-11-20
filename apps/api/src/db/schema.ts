import type { HomeModel } from '@my-home/shared';
import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** One row per home; `model` is the validated HomeModel document and `id` equals `model.id`. */
export const homes = pgTable('homes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  model: jsonb('model').$type<HomeModel>().notNull(),
  ...timestamps,
});

export type HomeRow = typeof homes.$inferSelect;

/**
 * The deprecated named furniture layouts (#56): nothing in this api reads or writes them any more.
 * The table stays for one release so a rollback to the previous api version (its release job's
 * one-time import and its layouts routes) still finds it; a later release drops it.
 */
export const layouts = pgTable(
  'layouts',
  {
    id: text('id').primaryKey(),
    homeId: text('home_id')
      .notNull()
      .references(() => homes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    version: integer('version').notNull().default(1),
    items: jsonb('items').$type<unknown[]>().notNull(),
    ...timestamps,
  },
  (t) => [index('layouts_home_id_idx').on(t.homeId)],
);
