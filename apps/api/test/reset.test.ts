import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetDatabase } from '../src/db/reset';
import { seed } from '../src/db/seed';
import { createTestApp } from './helpers';

describe('resetDatabase', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.app.close());

  it('drops all data so the next migration starts from an empty database', async () => {
    const { db } = ctx.database;
    await seed(db);
    const layout = await ctx.app.inject({
      method: 'POST',
      url: '/api/homes/mock-home/layouts',
      payload: { name: 'Before reset', items: [] },
    });
    expect(layout.statusCode).toBe(201);

    await resetDatabase(db);
    // Both drivers return `{ rows }`; the shared Db type leaves the result untyped.
    const tables = (await db.execute(
      sql`select count(*)::int as count from information_schema.tables where table_schema = 'public'`,
    )) as unknown as { rows: { count: number }[] };
    expect(tables.rows[0]?.count).toBe(0);

    await ctx.database.migrate();
    expect((await seed(db)).status).toBe('inserted');
    const layouts = await ctx.app.inject({ method: 'GET', url: '/api/homes/mock-home/layouts' });
    expect(layouts.json().items).toHaveLength(0);
  });
});
