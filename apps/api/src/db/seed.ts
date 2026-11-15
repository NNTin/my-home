import { sql } from 'drizzle-orm';
import type { Db } from './client';
import { homes } from './schema';

export const sampleHomes = ['Mock home'];

/** Inserts the sample rows when the table is empty. Safe to run repeatedly. */
export async function seed(db: Db): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(homes);
  if ((row?.count ?? 0) > 0) return 0;
  const inserted = await db
    .insert(homes)
    .values(sampleHomes.map((name) => ({ name })))
    .returning({ id: homes.id });
  return inserted.length;
}
