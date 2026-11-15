import { HealthResponse } from '@my-home/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers';

describe('GET /api/health', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.app.close());

  it('reports ok including the database check', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = HealthResponse.parse(res.json());
    expect(body.status).toBe('ok');
    expect(body.db).toMatchObject({
      status: 'ok',
      driver: process.env.DATABASE_URL ? 'postgres' : 'pglite',
    });
  });

  it('returns 503 when the database is unreachable', async () => {
    const { app, database } = await createTestApp();
    const original = database.ping;
    database.ping = () => Promise.reject(new Error('connection refused'));
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ status: 'error', db: { status: 'error' } });
    } finally {
      database.ping = original;
      await app.close();
    }
  });
});
