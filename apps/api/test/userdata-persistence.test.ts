import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Placement } from '@my-home/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase } from '../src/db/reset';
import { schemaMigration } from '../src/db/schema-migrate';
import { seedHomes } from '../src/db/seed';
import { migrateUserdata, readUserdataMigrations } from '../src/db/userdata-migrate';
import { userdataMigrationsFolder } from '../src/paths';
import { clearUserdata, createTestApp, injector } from './helpers';

const TABLES = [
  'history',
  'home_settings',
  'issued_ids',
  'notes',
  'opening_overrides',
  'placements',
  'schema_migrations',
];

describe('the userdata schema outlives resets and other branches', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let inject: ReturnType<typeof injector>;
  beforeAll(async () => {
    ctx = await createTestApp();
    inject = injector(ctx);
  });
  beforeEach(async () => {
    await clearUserdata(ctx);
    await seedHomes(ctx.database.db);
  });
  afterAll(() => ctx.app.close());

  const rows = async <T>(query: ReturnType<typeof sql>) =>
    ((await ctx.database.db.execute(query)) as unknown as { rows: T[] }).rows;
  const place = async () => {
    const res = await inject('POST', '/api/homes/mock-home/placements', {
      typeId: 'furniture.bed',
      levelId: 'souterrain',
      position: { x: -3, z: 2.5 },
    });
    expect(res.statusCode, res.body).toBe(201);
    return Placement.parse(res.json());
  };

  /** Everything a deploy must not change. */
  const snapshot = async () => ({
    placements: (await inject('GET', '/api/homes/mock-home/placements?include=removed')).json(),
    overrides: (await inject('GET', '/api/homes/mock-home/opening-overrides')).json(),
    uses: (await inject('GET', '/api/homes/mock-home/uses')).json(),
    history: await rows(sql`select * from userdata.history order by seq`),
    issued: await rows(sql`select home_id, id from userdata.issued_ids order by id`),
    notes: await rows(sql`select * from userdata.notes order by created_at, id`),
    journal: await rows(sql`select tag, checksum from userdata.schema_migrations order by tag`),
  });

  it('a staging deploy (reset, migrate, seed) keeps placements, overrides, history and ids', async () => {
    const bed = await place();
    await inject('PATCH', `/api/homes/mock-home/placements/${bed.id}`, {
      version: 1,
      params: { width: 1.8 },
    });
    const trashed = await place();
    await inject('DELETE', `/api/homes/mock-home/placements/${trashed.id}?version=1`);
    await inject('PUT', '/api/homes/mock-home/opening-overrides/souterrain-kitchen-window', {
      version: 0,
      params: { frameColor: '#383e42' },
    });

    for (const note of [
      { subject: { kind: 'type', id: 'window.casement' }, body: 'Replaced in 2019' },
      { subject: { kind: 'use', id: bed.id }, homeId: 'mock-home', body: 'Squeaks' },
      { subject: { kind: 'use', id: bed.id }, homeId: 'mock-home', body: 'Deleted later' },
    ]) {
      expect((await inject('POST', '/api/notes', note)).statusCode).toBe(201);
    }
    const deleted = (
      await inject('GET', `/api/notes?subject=use:${bed.id}&homeId=mock-home`)
    ).json().items[1];
    expect((await inject('DELETE', `/api/notes/${deleted.id}`)).statusCode).toBe(204);

    const before = await snapshot();
    expect(before.notes).toHaveLength(3);
    expect(before.placements.items).toHaveLength(2);
    expect(before.history).toHaveLength(5);

    for (let deploy = 0; deploy < 2; deploy++) {
      await resetDatabase(ctx.database.db);
      const tables = await rows<{ table: string }>(sql`
        select table_name as table from information_schema.tables
        where table_schema = 'userdata' order by table_name`);
      expect(tables.map((t) => t.table)).toEqual(TABLES);

      await ctx.database.migrate();
      await seedHomes(ctx.database.db);
      expect(await snapshot()).toEqual(before);
    }
    // The next id continues after the ones issued before the deploys.
    expect((await place()).id).toBe('souterrain-bed-3');
  });

  it('the reset never mentions userdata', () => {
    const source = readFileSync(join(__dirname, '../src/db/reset.ts'), 'utf8');
    expect(source).not.toMatch(/userdata/i);
  });

  describe('migrations from branches deployed in any order', () => {
    const newer = schemaMigration(
      '9001_test_newer_branch',
      `alter table userdata.placements add column if not exists test_newer_column text default 'new';
       --> statement-breakpoint
       create table if not exists userdata.test_newer_table (id text primary key);`,
    );
    const journal = async () =>
      (
        await rows<{ tag: string }>(sql`select tag from userdata.schema_migrations order by tag`)
      ).map((r) => r.tag);
    const current = readUserdataMigrations().map((m) => m.tag);

    afterAll(async () => {
      await ctx.database.db.execute(sql`drop table if exists userdata.test_newer_table`);
      await ctx.database.db.execute(sql`drop table if exists userdata.test_other_branch`);
      await ctx.database.db.execute(
        sql`alter table userdata.placements drop column if exists test_newer_column`,
      );
      await ctx.database.db.execute(
        sql`delete from userdata.schema_migrations where tag like '%_test_%'`,
      );
    });

    it('leaves an unknown newer tag alone and keeps working on the newer schema', async () => {
      const bed = await place();
      expect(await migrateUserdata(ctx.database.db, [...readUserdataMigrations(), newer])).toEqual([
        newer.tag,
      ]);
      await resetDatabase(ctx.database.db);
      await ctx.database.migrate();
      await seedHomes(ctx.database.db);
      expect(await migrateUserdata(ctx.database.db)).toEqual([]);
      expect(await journal()).toEqual([...current, newer.tag]);
      const again = await place();
      expect(
        await rows(sql`select id, test_newer_column from userdata.placements order by id`),
      ).toEqual([
        { id: bed.id, test_newer_column: 'new' },
        { id: again.id, test_newer_column: 'new' },
      ]);
    });

    it('applies a missing migration that sorts before ones already applied', async () => {
      const other = schemaMigration(
        '0000_a_test_other_branch',
        'create table if not exists userdata.test_other_branch (id text primary key);',
      );
      expect(other.tag < current.at(-1)!).toBe(true);
      const set = [other, ...readUserdataMigrations()];
      expect(await migrateUserdata(ctx.database.db, set)).toEqual([other.tag]);
      expect(await migrateUserdata(ctx.database.db, set)).toEqual([]);
    });

    it('is idempotent: every migration can run again on a migrated database', async () => {
      const bed = await place();
      for (const migration of readUserdataMigrations()) {
        for (const statement of migration.statements)
          await ctx.database.db.execute(sql.raw(statement));
      }
      expect(
        (await inject('GET', `/api/homes/mock-home/uses/${bed.id}/history`)).json().items,
      ).toHaveLength(1);
    });
  });

  describe('userdata migrations are expand-only', () => {
    const files = readdirSync(userdataMigrationsFolder).filter((f) => f.endsWith('.sql'));
    const text = (file: string) =>
      readFileSync(join(userdataMigrationsFolder, file), 'utf8').replace(/--(?!>).*$/gm, '');

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
        /\bupdate\s+userdata\./i,
        /\balter\s+column\b/i,
        /\bset\s+not\s+null\b/i,
        /\badd\s+constraint\b/i,
        /\bcheck\s*\(/i,
        /\breferences\b/i,
        /\bpublic\./i,
      ];
      for (const pattern of forbidden) expect(text(file)).not.toMatch(pattern);
      for (const statement of schemaMigration(file, text(file)).statements) {
        expect(statement).toMatch(
          /^(create table if not exists userdata\.|create (unique )?index if not exists \w+ on userdata\.|alter table userdata\.\w+ add column if not exists )/i,
        );
        if (/^alter table/i.test(statement) && /\bnot null\b/i.test(statement)) {
          expect(statement).toMatch(/\bdefault\b/i);
        }
      }
    });
  });
});
