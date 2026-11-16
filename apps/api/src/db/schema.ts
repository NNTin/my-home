import type { HomeModel } from '@my-home/shared';
import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

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
