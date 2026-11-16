import type { HomeModel, LayoutItem } from '@my-home/shared';
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
 * Named furniture layouts of a home, stored apart from the home model. Items reference levels and
 * rooms by id only, so replacing or re-seeding a home never touches its layouts; deleting the
 * home deletes them. `version` implements optimistic concurrency for updates.
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
    items: jsonb('items').$type<LayoutItem[]>().notNull(),
    ...timestamps,
  },
  (t) => [index('layouts_home_id_idx').on(t.homeId)],
);

export type LayoutRow = typeof layouts.$inferSelect;
