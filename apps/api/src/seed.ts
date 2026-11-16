import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { seed } from './db/seed';

// pnpm db:seed [file] [--replace]; a relative file resolves against the directory pnpm ran in.
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { replace: { type: 'boolean', default: false } },
});
const config = loadConfig();
const cwd = process.env.INIT_CWD ?? process.cwd();
const fileArg = positionals[0] ?? config.seedFile;
const file = fileArg === undefined ? undefined : resolve(cwd, fileArg);

const database = createDatabase(config, { error: (obj, msg) => console.error(msg, obj) });
try {
  await database.migrate();
  const result = await seed(database.db, { file, replace: values.replace });
  console.log(`seed finished: home "${result.id}" ${result.status} (${database.driver})`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await database.close();
}
