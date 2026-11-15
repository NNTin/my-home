import { HealthResponse } from '@my-home/shared';
import { sql } from 'drizzle-orm';
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
      expect(res.json()).toMatchObject({
        status: 'error',
        db: { status: 'error', error: 'database unavailable' },
      });
      expect(res.body).not.toContain('connection refused');
    } finally {
      database.ping = original;
      await app.close();
    }
  });

  it.skipIf(!process.env.DATABASE_URL)(
    'survives postgres terminating idle pool clients',
    async () => {
      await ctx.database.ping(); // leaves an idle client in ctx's pool
      const killer = await createTestApp();
      try {
        await killer.database.db.execute(
          sql`select pg_terminate_backend(pid) from pg_stat_activity
              where datname = current_database() and pid <> pg_backend_pid()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
        const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
        expect(res.statusCode).toBe(200);
      } finally {
        await killer.app.close();
      }
    },
  );
});
