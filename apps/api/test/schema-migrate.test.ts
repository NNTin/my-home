import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { createDatabase, type Database } from '../src/db/client';
import { migrateMedia } from '../src/db/media-migrate';
import { schemaMigration } from '../src/db/schema-migrate';
import { migrateUserdata } from '../src/db/userdata-migrate';

describe.each([
  { schema: 'media', migrate: migrateMedia },
  { schema: 'userdata', migrate: migrateUserdata },
])('$schema migration checksums', ({ schema, migrate }) => {
  let database: Database;
  const originalSql = `create table if not exists ${schema}.test_checksum (id text primary key);`;
  const original = schemaMigration('9002_test_checksum', originalSql);
  const pending = schemaMigration(
    '0000_test_checksum_pending',
    `create table if not exists ${schema}.test_checksum_pending (id text primary key);
     --> statement-breakpoint
     select 1 / 0;`,
  );
  const rows = async (query: ReturnType<typeof sql>) =>
    ((await database.db.execute(query)) as unknown as { rows: unknown[] }).rows;
  const snapshot = async () => ({
    journal: await rows(
      sql`select * from ${sql.identifier(schema)}.schema_migrations order by tag`,
    ),
    data: await rows(sql`select * from ${sql.identifier(schema)}.test_checksum order by id`),
    columns: await rows(sql`
      select table_name, column_name, data_type from information_schema.columns
      where table_schema = ${schema} order by table_name, ordinal_position`),
  });

  beforeAll(async () => {
    database = createDatabase(loadConfig({ ...process.env, PGLITE_DIR: 'memory://' }), {
      error: () => {},
    });
    await database.migrate();
    expect(await migrate(database.db, [original])).toEqual([original.tag]);
    await database.db.execute(
      sql`insert into ${sql.identifier(schema)}.test_checksum (id) values ('kept')`,
    );
  });

  afterAll(async () => {
    try {
      await database.db.execute(
        sql`drop table if exists ${sql.identifier(schema)}.test_checksum_pending`,
      );
      await database.db.execute(sql`drop table if exists ${sql.identifier(schema)}.test_checksum`);
      await database.db.execute(sql`
        delete from ${sql.identifier(schema)}.schema_migrations
        where tag in (${original.tag}, ${pending.tag})`);
    } finally {
      await database.close();
    }
  });

  it('leaves identical known migrations and their data unchanged', async () => {
    const before = await snapshot();
    expect(await migrate(database.db, [schemaMigration(original.tag, originalSql)])).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it('rejects known-tag drift before any pending SQL and leaves the journal and data unchanged', async () => {
    const changed = schemaMigration(
      original.tag,
      `alter table ${schema}.test_checksum add column if not exists changed text;`,
    );
    const before = await snapshot();
    // Pending SQL would fail with division by zero if it ran before the checksum preflight.
    await expect(migrate(database.db, [pending, changed])).rejects.toThrow(
      `Migration checksum mismatch for ${schema}/${original.tag}`,
    );
    expect(await snapshot()).toEqual(before);
    expect(await migrate(database.db, [original])).toEqual([]);
  });

  it('leaves unknown newer journal tags and their checksums untouched', async () => {
    const before = await snapshot();
    expect(await migrate(database.db, [])).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });
});
