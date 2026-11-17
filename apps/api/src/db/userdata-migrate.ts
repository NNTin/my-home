import { userdataMigrationsFolder } from '../paths';
import type { Db } from './client';
import { migrateSchema, readSchemaMigrations, type SchemaMigration } from './schema-migrate';
import { USERDATA_SCHEMA } from './userdata-schema';

/** The `userdata` migrations in file-name order. */
export const readUserdataMigrations = (folder = userdataMigrationsFolder): SchemaMigration[] =>
  readSchemaMigrations(folder);

/** Applies the `userdata` schema's migrations (placements, overrides, history); see `migrateSchema`. */
export const migrateUserdata = (db: Db, migrations = readUserdataMigrations()): Promise<string[]> =>
  migrateSchema(db, {
    schema: USERDATA_SCHEMA,
    folder: userdataMigrationsFolder,
    lockKey: 7216002,
    migrations,
  });
