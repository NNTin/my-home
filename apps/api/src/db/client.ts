import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import type { Config } from '../config';
import { migrationsFolder } from '../paths';
import { migrateMedia } from './media-migrate';
import { migrateUserdata } from './userdata-migrate';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type DbDriver = 'pglite' | 'postgres';

/** The subset of a pino logger the database layer needs. */
export interface DbLogger {
  error(obj: object, msg: string): void;
}

export interface Database {
  db: Db;
  driver: DbDriver;
  /**
   * Applies the `public` migrations (drizzle), then the `media` schema's own (photos), then the
   * `userdata` schema's (placements, overrides, history).
   */
  migrate(): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

/** node-postgres when DATABASE_URL is set, otherwise PGlite (a directory or `memory://`). */
export function createDatabase(
  config: Pick<Config, 'databaseUrl' | 'pgliteDir'>,
  logger: DbLogger,
): Database {
  if (config.databaseUrl) {
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
    // An idle client losing its connection emits `error` on the pool; without a listener that
    // crashes the process. The pool discards the broken client and /api/health reports outages.
    pool.on('error', (err) => logger.error({ err }, 'idle postgres client error'));
    const db = drizzlePg({ client: pool, schema });
    return {
      db: db as unknown as Db,
      driver: 'postgres',
      migrate: async () => {
        await migratePg(db, { migrationsFolder });
        await migrateMedia(db as unknown as Db);
        await migrateUserdata(db as unknown as Db);
      },
      ping: async () => void (await db.execute(sql`select 1`)),
      close: () => pool.end(),
    };
  }

  const dataDir = config.pgliteDir;
  if (!dataDir.includes('://')) mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzlePglite({ client, schema });
  return {
    db: db as unknown as Db,
    driver: 'pglite',
    migrate: async () => {
      await migratePglite(db, { migrationsFolder });
      await migrateMedia(db as unknown as Db);
      await migrateUserdata(db as unknown as Db);
    },
    ping: async () => void (await db.execute(sql`select 1`)),
    close: () => client.close(),
  };
}
