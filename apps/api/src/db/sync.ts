import { readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { HomeModel } from '@my-home/shared';
import { asc, eq } from 'drizzle-orm';
import { homesFolder } from '../paths';
import type { Db } from './types';
import { sameJson } from './history';
import { homeStore } from './homes';
import { homes } from './schema';
import { readHomeFile } from './seed';
import { isSeedFile } from './seed-sync';
import { useStore } from './uses';

/**
 * The home files a release syncs: `names` (resolved against `folder` unless absolute) when given,
 * otherwise every `*.json` in `folder` but the seeds (`*.seed.json`), `home.json` first (the
 * viewer opens the oldest home).
 */
export async function homeFiles(
  names: string[] | undefined,
  folder: string = homesFolder,
): Promise<string[]> {
  if (names) return names.map((name) => (isAbsolute(name) ? name : join(folder, name)));
  const found = (await readdir(folder))
    .filter((name) => name.endsWith('.json') && !isSeedFile(name))
    .sort();
  const ordered = [
    ...found.filter((name) => name === 'home.json'),
    ...found.filter((name) => name !== 'home.json'),
  ];
  return ordered.map((name) => join(folder, name));
}

/** Reads and validates every file before anything is written; throws on the first bad one. */
export async function loadHomeFiles(files: string[]): Promise<HomeModel[]> {
  if (files.length === 0) throw new Error('No home files to sync');
  const models: HomeModel[] = [];
  for (const file of files) models.push(await readHomeFile(file));
  const seen = new Map<string, string>();
  models.forEach((model, i) => {
    const other = seen.get(model.id);
    if (other) throw new Error(`Home id "${model.id}" is in both ${other} and ${files[i]}`);
    seen.set(model.id, files[i]!);
  });
  return models;
}

export interface SyncResult {
  id: string;
  status: 'inserted' | 'replaced' | 'unchanged';
  /** Uses whose state needs a look after the change (orphan overrides, misfits); never deleted. */
  needsAttention: string[];
}

export interface SyncReport {
  homes: SyncResult[];
  /** Homes stored in the database but not synced: left alone. */
  notInGit: string[];
}

/**
 * Replaces the stored homes with `models` (or the validated `files`) in one transaction. A model
 * equal to the stored one is left as is. Homes not given are left alone, and nothing in `media`
 * or `userdata` is touched: uses that lost their opening show as needing attention.
 */
export async function syncHomes(
  db: Db,
  input: { models: HomeModel[] } | { files: string[] },
  options: { retentionDays?: number } = {},
): Promise<SyncReport> {
  const models = 'models' in input ? input.models : await loadHomeFiles(input.files);
  const statuses = await db.transaction(async (tx) => {
    const store = homeStore(tx as unknown as Db);
    const result: SyncResult['status'][] = [];
    for (const model of models) {
      const [stored] = await tx
        .select({ name: homes.name, model: homes.model })
        .from(homes)
        .where(eq(homes.id, model.id))
        .for('update');
      if (stored && stored.name === model.name && sameJson(stored.model, model)) {
        result.push('unchanged');
      } else {
        result.push((await store.upsert(model)) === 'created' ? 'inserted' : 'replaced');
      }
    }
    return result;
  });

  const uses = useStore(db, { retentionDays: options.retentionDays ?? 30 });
  const report: SyncReport = { homes: [], notInGit: [] };
  for (const [i, model] of models.entries()) {
    const attention = await uses.list(model.id, { status: 'needs-attention' });
    report.homes.push({
      id: model.id,
      status: statuses[i]!,
      needsAttention: attention.map((u) => u.id),
    });
  }
  const synced = new Set(models.map((m) => m.id));
  const stored = await db.select({ id: homes.id }).from(homes).orderBy(asc(homes.id));
  report.notInGit = stored.map((h) => h.id).filter((id) => !synced.has(id));
  return report;
}

/** The release log's lines for a sync. */
export function describeSync(report: SyncReport): { info: string[]; warn: string[] } {
  const info = report.homes.map(({ id, status, needsAttention: n }) => {
    const count = `${n.length} ${n.length === 1 ? 'use needs' : 'uses need'} attention`;
    return `release: home "${id}" ${status}, ${count}${n.length > 0 ? `: ${n.join(', ')}` : ''}`;
  });
  const warn = report.notInGit.map(
    (id) => `release: home "${id}" is stored but not in the synced files; left alone`,
  );
  return { info, warn };
}
