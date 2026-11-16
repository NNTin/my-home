import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { seed } from './db/seed';

// pnpm db:seed [file] [--replace]. A relative file argument resolves against the directory pnpm
// ran in; SEED_FILE, like in the server, against the api package.
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { replace: { type: 'boolean', default: false } },
});
const config = loadConfig();
const fileArg = positionals[0];
const file = fileArg ? resolve(process.env.INIT_CWD ?? process.cwd(), fileArg) : config.seedFile;

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
