import { ListHomesResponse } from '@my-home/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { homes } from '../src/db/schema';
import { sampleHomes, seed } from '../src/db/seed';
import { createTestApp } from './helpers';

describe('GET /api/homes', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeEach(async () => {
    if (ctx) await ctx.database.db.delete(homes);
    else ctx = await createTestApp();
  });
  afterAll(() => ctx.app.close());

  it('returns an empty list before seeding', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/homes' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });

  it('returns seeded homes matching the shared schema', async () => {
    expect(await seed(ctx.database.db)).toBe(sampleHomes.length);
    expect(await seed(ctx.database.db)).toBe(0); // idempotent

    const res = await ctx.app.inject({ method: 'GET', url: '/api/homes' });
    expect(res.statusCode).toBe(200);
    const body = ListHomesResponse.parse(res.json());
    expect(body.items.map((h) => h.name)).toEqual(sampleHomes);
  });

  it('honours and validates the limit query', async () => {
    await ctx.database.db.insert(homes).values([{ name: 'A' }, { name: 'B' }]);
    const limited = await ctx.app.inject({ method: 'GET', url: '/api/homes?limit=1' });
    expect(ListHomesResponse.parse(limited.json()).items).toHaveLength(1);

    const invalid = await ctx.app.inject({ method: 'GET', url: '/api/homes?limit=0' });
    expect(invalid.statusCode).toBe(400);
  });
});
