import { mediaMigrationsFolder } from '../paths';
import type { Db } from './types';
import { MEDIA_SCHEMA } from './media-schema';
import {
  migrateSchema,
  readSchemaMigrations,
  schemaMigration,
  type SchemaMigration,
} from './schema-migrate';

export type MediaMigration = SchemaMigration;

/** One migration of the `media` schema from the text of its file. */
export const mediaMigration = schemaMigration;

/** The `media` migrations in file-name order. */
export const readMediaMigrations = (folder = mediaMigrationsFolder): MediaMigration[] =>
  readSchemaMigrations(folder);

/** Applies the `media` schema's migrations (photos); see `migrateSchema`. */
export const migrateMedia = (db: Db, migrations = readMediaMigrations()): Promise<string[]> =>
  migrateSchema(db, {
    schema: MEDIA_SCHEMA,
    folder: mediaMigrationsFolder,
    lockKey: 7216001,
    migrations,
  });
