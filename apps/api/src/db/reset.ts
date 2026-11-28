import { sql } from 'drizzle-orm';
import type { Db } from './types';

/**
 * Drops every table and the migration journal, leaving an empty `public` schema. Used by
 * throwaway environments (staging) so each deploy starts from a freshly migrated database.
 */
export async function resetDatabase(db: Db): Promise<void> {
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`create schema public`);
}
