import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetDatabase } from '../src/db/reset';
import { seed } from '../src/db/seed';
import { createTestApp } from './helpers';
import { mockHomeFile } from './fixtures';

describe('resetDatabase', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.app.close());

  it('drops all data so the next migration starts from an empty database', async () => {
    const { db } = ctx.database;
    await seed(db, { file: mockHomeFile });

    await resetDatabase(db);
    // Both drivers return `{ rows }`; the shared Db type leaves the result untyped.
    const tables = (await db.execute(
      sql`select count(*)::int as count from information_schema.tables where table_schema = 'public'`,
    )) as unknown as { rows: { count: number }[] };
    expect(tables.rows[0]?.count).toBe(0);

    await ctx.database.migrate();
    expect((await seed(db, { file: mockHomeFile })).status).toBe('inserted');
    const home = await ctx.app.inject({ method: 'GET', url: '/api/homes/mock-home' });
    expect(home.statusCode).toBe(200);
  });
});
