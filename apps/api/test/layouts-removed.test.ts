import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../src/db/seed';
import { createTestApp, injector } from './helpers';
import { mockHomeFile } from './fixtures';

describe('the named layouts are gone (#56)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let inject: ReturnType<typeof injector>;
  beforeAll(async () => {
    ctx = await createTestApp();
    inject = injector(ctx);
    await seed(ctx.database.db, { file: mockHomeFile });
  });
  afterAll(() => ctx.app.close());

  it('drops public.layouts and keeps userdata.imports', async () => {
    // Both drivers return `{ rows }`; the shared Db type leaves the result untyped.
    const tables = (await ctx.database.db.execute(
      sql`select table_schema || '.' || table_name as name from information_schema.tables
          where table_name in ('layouts', 'imports') order by name`,
    )) as unknown as { rows: { name: string }[] };
    expect(tables.rows.map((r) => r.name)).toEqual(['userdata.imports']);
  });

  it('answers the old routes with 404 and still lists the placements', async () => {
    expect((await inject('GET', '/api/homes/mock-home/layouts')).statusCode).toBe(404);
    expect(
      (await inject('POST', '/api/homes/mock-home/layouts', { name: 'L', items: [] })).statusCode,
    ).toBe(404);
    expect((await inject('GET', '/api/layouts/some-id')).statusCode).toBe(404);
    const placements = await inject('GET', '/api/homes/mock-home/placements');
    expect(placements.statusCode).toBe(200);
    expect(placements.json()).toHaveProperty('items');
  });
});
