import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ListPhotosResponse, Photo, PhotoRequest, TrashResponse } from '@my-home/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mediaMigration, migrateMedia, readMediaMigrations } from '../src/db/media-migrate';
import { photoBlobs, photoThumbnails } from '../src/db/media-schema';
import { resetDatabase } from '../src/db/reset';
import { seedHomes } from '../src/db/seed';
import { mediaMigrationsFolder } from '../src/paths';
import { clearMedia, createTestApp, testImage, uploadPayload } from './helpers';

describe('the media schema outlives resets and other branches', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await clearMedia(ctx);
    await seedHomes(ctx.database.db);
  });
  afterAll(() => ctx.app.close());

  const inject = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) =>
    ctx.app.inject({ method, url, ...(payload !== undefined && { payload: payload as object }) });
  const rows = async <T>(query: ReturnType<typeof sql>) =>
    // Both drivers return `{ rows }`; the shared Db type leaves the result untyped.
    ((await ctx.database.db.execute(query)) as unknown as { rows: T[] }).rows;

  const upload = async (meta: object = {}) => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/homes/mock-home/photos',
      ...(await uploadPayload(
        {
          levelId: 'souterrain',
          pose: { position: { x: -3, y: -1, z: 2.5 }, yaw: 0.5, pitch: 0 },
          ...meta,
        },
        await testImage(),
      )),
    });
    expect(res.statusCode, res.body).toBe(201);
    return Photo.parse(res.json());
  };

  /** Everything a deploy must not change: metadata, image bytes, requests and the trash. */
  const snapshot = async () => ({
    photos: ListPhotosResponse.parse((await inject('GET', '/api/homes/mock-home/photos')).json()),
    requests: (await inject('GET', '/api/homes/mock-home/photo-requests?status=all')).json(),
    trash: TrashResponse.parse((await inject('GET', '/api/homes/mock-home/trash')).json()),
    blobs: (await ctx.database.db.select().from(photoBlobs)).map((b) => [
      b.photoId,
      b.data.toString('base64'),
    ]),
    thumbnails: (await ctx.database.db.select().from(photoThumbnails)).map((t) => [
      t.photoId,
      t.data.toString('base64'),
    ]),
    journal: await rows(sql`select tag, checksum from media.schema_migrations order by tag`),
  });

  it('a staging deploy (reset, migrate, seed) keeps every photo, blob, request and trash entry', async () => {
    const request = PhotoRequest.parse(
      (
        await inject('POST', '/api/homes/mock-home/photo-requests', {
          roomId: 'souterrain-bedroom',
          reason: 'Where is the radiator?',
          requester: 'agent',
        })
      ).json(),
    );
    const kept = await upload({ note: 'Radiator', tags: ['wall'], requestId: request.id });
    const trashed = await upload({ note: 'Blurry' });
    await inject('DELETE', `/api/photos/${trashed.id}`);
    const trashedRequest = PhotoRequest.parse(
      (
        await inject('POST', '/api/homes/mock-home/photo-requests', {
          roomId: 'souterrain-kitchen',
          reason: 'Obsolete',
          requester: 'owner',
        })
      ).json(),
    );
    await inject('DELETE', `/api/photo-requests/${trashedRequest.id}`);

    const before = await snapshot();
    expect(before.photos.items.map((p) => p.id)).toEqual([kept.id]);
    expect(before.trash.photos.map((p) => p.id)).toEqual([trashed.id]);
    expect(before.trash.requests.map((r) => r.id)).toEqual([trashedRequest.id]);
    expect(before.blobs).toHaveLength(2);
    expect(before.thumbnails).toHaveLength(2);

    // Exactly what `dist/reset.js` does on every staging deploy, twice over.
    for (let deploy = 0; deploy < 2; deploy++) {
      await resetDatabase(ctx.database.db);
      const tables = await rows<{ schema: string; count: number }>(sql`
        select table_schema as schema, count(*)::int as count from information_schema.tables
        where table_schema in ('public', 'drizzle', 'media') group by table_schema`);
      expect(tables).toEqual([{ schema: 'media', count: 5 }]);

      await ctx.database.migrate();
      await seedHomes(ctx.database.db);
      expect(await snapshot()).toEqual(before);
    }
    expect(Photo.parse((await inject('GET', `/api/photos/${kept.id}`)).json())).toEqual(kept);
  });

  it('the reset drops nothing but the public and drizzle schemas', () => {
    const source = readFileSync(join(__dirname, '../src/db/reset.ts'), 'utf8');
    const dropped = [...source.matchAll(/drop schema if exists (\w+)/g)].map((m) => m[1]);
    expect(dropped.sort()).toEqual(['drizzle', 'public']);
    expect(source).not.toMatch(/media|truncate|delete from/i);
  });

  describe('migrations from branches deployed in any order', () => {
    // What a newer branch might add: a column older code does not write, and a new table.
    const newer = mediaMigration(
      '9001_test_newer_branch',
      `alter table media.photos add column if not exists test_newer_column text default 'new';
       --> statement-breakpoint
       create table if not exists media.test_newer_table (id text primary key);`,
    );
    const journal = async () =>
      (await rows<{ tag: string }>(sql`select tag from media.schema_migrations order by tag`)).map(
        (r) => r.tag,
      );
    const current = readMediaMigrations().map((m) => m.tag);

    afterAll(async () => {
      // Leave the shared test database as other test files expect it.
      await ctx.database.db.execute(sql`drop table if exists media.test_newer_table`);
      await ctx.database.db.execute(sql`drop table if exists media.test_other_branch`);
      await ctx.database.db.execute(
        sql`alter table media.photos drop column if exists test_newer_column`,
      );
      await ctx.database.db.execute(
        sql`delete from media.schema_migrations where tag like '%_test_%'`,
      );
    });

    it('an older migration set runs against a newer media schema', async () => {
      const before = await upload({ note: 'Taken on the newer branch' });
      expect(await migrateMedia(ctx.database.db, [...readMediaMigrations(), newer])).toEqual([
        newer.tag,
      ]);
      expect(await journal()).toEqual([...current, newer.tag]);

      // The older branch deploys next: reset, then its own (smaller) migration set.
      await resetDatabase(ctx.database.db);
      await ctx.database.migrate();
      await seedHomes(ctx.database.db);
      expect(await migrateMedia(ctx.database.db)).toEqual([]);
      // The journal entry it does not know and the newer column and table are left alone.
      expect(await journal()).toEqual([...current, newer.tag]);
      expect(await rows(sql`select * from media.test_newer_table`)).toEqual([]);

      // The older code still reads old photos and writes new ones.
      expect(Photo.parse((await inject('GET', `/api/photos/${before.id}`)).json())).toEqual(before);
      const after = await upload({ note: 'Taken on the older branch' });
      expect(
        await rows(sql`select test_newer_column from media.photos where id = ${after.id}`),
      ).toEqual([{ test_newer_column: 'new' }]);
      expect((await inject('GET', '/api/homes/mock-home/photos')).json().total).toBe(2);
    });

    it('applies a migration that sorts before ones already applied', async () => {
      // Two branches each add a migration; whichever deploys second still gets its own applied,
      // although a later-sorting one is already in the journal.
      const other = mediaMigration(
        '0000_a_test_other_branch',
        'create table if not exists media.test_other_branch (id text primary key);',
      );
      expect(other.tag < current.at(-1)!).toBe(true);
      const set = [other, ...readMediaMigrations()];
      expect(await migrateMedia(ctx.database.db, set)).toEqual([other.tag]);
      expect(await migrateMedia(ctx.database.db, set)).toEqual([]);
      expect(await rows(sql`select * from media.test_other_branch`)).toEqual([]);
    });

    it('is idempotent: every migration can run again on a migrated database', async () => {
      const { db } = ctx.database;
      const photo = await upload();
      for (const migration of readMediaMigrations()) {
        for (const statement of migration.statements) await db.execute(sql.raw(statement));
      }
      expect((await inject('GET', `/api/photos/${photo.id}/image`)).statusCode).toBe(200);
    });
  });

  describe('media migrations are expand-only', () => {
    const files = readdirSync(mediaMigrationsFolder).filter((f) => f.endsWith('.sql'));
    const text = (file: string) =>
      readFileSync(join(mediaMigrationsFolder, file), 'utf8').replace(/--(?!>).*$/gm, '');

    it('has migrations with unique, ordered names', () => {
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) expect(file).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
    });

    it.each(files)('%s only adds tables, columns and indexes', (file) => {
      const forbidden = [
        /\bdrop\b/i,
        /\brename\b/i,
        /\btruncate\b/i,
        /\bdelete\s+from\b/i,
        /\bupdate\s+media\./i,
        /\balter\s+column\b/i,
        /\bset\s+not\s+null\b/i,
        /\badd\s+constraint\b/i,
        /\bpublic\./i,
      ];
      for (const pattern of forbidden) expect(text(file)).not.toMatch(pattern);

      for (const statement of mediaMigration(file, text(file)).statements) {
        // Idempotent, and only inside the media schema.
        expect(statement).toMatch(
          /^(create table if not exists media\.|create (unique )?index if not exists \w+ on media\.|alter table media\.\w+ add column if not exists )/i,
        );
        // A column added later must not break older code that does not write it.
        if (/^alter table/i.test(statement) && /\bnot null\b/i.test(statement)) {
          expect(statement).toMatch(/\bdefault\b/i);
        }
        expect(statement).not.toMatch(/references\s+(?!media\.)/i);
      }
    });
  });
});
