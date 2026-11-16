import { z } from 'zod';

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** When set, node-postgres is used; otherwise PGlite. */
  DATABASE_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  /** PGlite data directory (relative to the api package) or `memory://`. */
  PGLITE_DIR: z.string().default('.data/pglite'),
  MIGRATE_ON_START: z.preprocess(emptyToUndefined, z.stringbool().default(true)),
  SEED_ON_START: z.preprocess(emptyToUndefined, z.stringbool().optional()),
  /** Home file seeded on start and by `pnpm db:seed`; defaults to data/homes/mock-home.json. */
  SEED_FILE: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Git commit of the release, reported by `GET /api/health/live`. */
  APP_COMMIT: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Allows `dist/reset.js` to drop all data. Set only for throwaway environments (staging). */
  ALLOW_DATABASE_RESET: z.preprocess(emptyToUndefined, z.stringbool().default(false)),
});

export type Config = {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: z.infer<typeof EnvSchema>['LOG_LEVEL'];
  databaseUrl: string | undefined;
  pgliteDir: string;
  migrateOnStart: boolean;
  seedOnStart: boolean;
  seedFile: string | undefined;
  commit: string | null;
  allowDatabaseReset: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  const e = result.data;
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    pgliteDir: e.PGLITE_DIR,
    migrateOnStart: e.MIGRATE_ON_START,
    seedOnStart: e.SEED_ON_START ?? e.NODE_ENV === 'development',
    seedFile: e.SEED_FILE,
    commit: e.APP_COMMIT ?? null,
    allowDatabaseReset: e.ALLOW_DATABASE_RESET,
  };
}
