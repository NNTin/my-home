import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { Db } from './client';

export interface SchemaMigration {
  /** The file name without `.sql`; the key in the journal. */
  tag: string;
  statements: string[];
  checksum: string;
}

/** One migration from the text of its file; statements are separated by `--> statement-breakpoint`. */
export function schemaMigration(tag: string, text: string): SchemaMigration {
  return {
    tag,
    statements: text
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s !== ''),
    checksum: createHash('sha256').update(text).digest('hex'),
  };
}

/** The `*.sql` files of a folder in file-name order. */
export function readSchemaMigrations(folder: string): SchemaMigration[] {
  return readdirSync(folder)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => schemaMigration(file.slice(0, -4), readFileSync(join(folder, file), 'utf8')));
}

export interface MigrateSchemaOptions {
  /** The schema the migrations live in; its journal is `<schema>.schema_migrations`. */
  schema: string;
  /** Read when `migrations` is not given. */
  folder: string;
  /** The advisory lock key: one migrator per schema at a time. */
  lockKey: number;
  migrations?: SchemaMigration[];
}

/**
 * Applies a persistent schema's hand-written migrations (`media`, `userdata`) and returns the tags
 * it applied.
 *
 * Unlike drizzle's migrator this one is order-independent, because branches deploy to the shared
 * staging database in any order: every migration whose tag is not in the schema's journal
 * (`<schema>.schema_migrations`) is applied, whatever was applied before or after it, and journal
 * entries this build does not know (from a newer branch) are left alone. That is only safe
 * because the migrations are expand-only and idempotent (docs/photos.md, docs/userdata.md).
 */
export async function migrateSchema(db: Db, options: MigrateSchemaOptions): Promise<string[]> {
  const migrations = options.migrations ?? readSchemaMigrations(options.folder);
  const schema = sql.identifier(options.schema);
  return db.transaction(async (tx) => {
    // One migrator at a time; the lock is released with the transaction.
    await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(String(options.lockKey))})`);
    await tx.execute(sql`create schema if not exists ${schema}`);
    await tx.execute(sql`
      create table if not exists ${schema}.schema_migrations (
        tag text primary key,
        checksum text not null,
        applied_at timestamp with time zone not null default now()
      )`);
    const journal = (await tx.execute(
      sql`select tag from ${schema}.schema_migrations`,
    )) as unknown as { rows: { tag: string }[] };
    const applied = new Set(journal.rows.map((row) => row.tag));

    const pending = migrations.filter((m) => !applied.has(m.tag));
    for (const migration of pending) {
      for (const statement of migration.statements) await tx.execute(sql.raw(statement));
      await tx.execute(
        sql`insert into ${schema}.schema_migrations (tag, checksum) values (${migration.tag}, ${migration.checksum})`,
      );
    }
    return pending.map((m) => m.tag);
  });
}
