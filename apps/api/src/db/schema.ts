import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** Sample table for the boilerplate; Epic 2 replaces or extends it. */
export const homes = pgTable('homes', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  ...timestamps,
});

export type HomeRow = typeof homes.$inferSelect;
