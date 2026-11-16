import { readFile } from 'node:fs/promises';
import { describeIssues, formatIssues, HomeModel } from '@my-home/shared';
import { defaultHomeFile, defaultSeedFiles } from '../paths';
import type { Db } from './client';
import { homeStore } from './homes';

/** Reads and validates a home file; throws with path-based messages when it is invalid. */
export async function readHomeFile(file: string): Promise<HomeModel> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot read home file ${file}: ${(err as Error).message}`, { cause: err });
  }
  const result = HomeModel.safeParse(json);
  if (!result.success) {
    throw new Error(`Invalid home file ${file}:\n${describeIssues(formatIssues(result.error))}`);
  }
  return result.data;
}

export interface SeedResult {
  id: string;
  status: 'inserted' | 'replaced' | 'unchanged';
}

/**
 * Loads a home file into the database. Idempotent: an existing home with the same id is left
 * alone unless `replace` is set.
 */
export async function seed(
  db: Db,
  { file = defaultHomeFile, replace = false }: { file?: string; replace?: boolean } = {},
): Promise<SeedResult> {
  const model = await readHomeFile(file);
  const store = homeStore(db);
  if (replace) {
    const status = await store.upsert(model);
    return { id: model.id, status: status === 'created' ? 'inserted' : 'replaced' };
  }
  return { id: model.id, status: (await store.insert(model)) ? 'inserted' : 'unchanged' };
}

/** Seeds `files` in order (the oldest home is shown first); defaults to `defaultSeedFiles`. */
export async function seedHomes(
  db: Db,
  { files = defaultSeedFiles, replace = false }: { files?: string[]; replace?: boolean } = {},
): Promise<SeedResult[]> {
  const results: SeedResult[] = [];
  for (const file of files) results.push(await seed(db, { file, replace }));
  return results;
}
