import type { Config } from '../core/config';
import type { Database } from './client';
import { purgeHome } from './purge';
import { resetDatabase } from './reset';
import { describeSeedSync, readSeedFile, seedFileOf, syncSeeds, type SeedInput } from './seed-sync';
import type { SeedSyncReport } from '@my-home/shared';
import { describeSync, homeFiles, loadHomeFiles, syncHomes, type SyncReport } from './sync';

export interface ReleaseLog {
  info(line: string): void;
  warn(line: string): void;
}

/**
 * The pre-deploy hook (`dist/release.js`) on every environment:
 * 1. read and validate every home file and its seed (`<home>.seed.json`, against the home and the
 *    catalogue), and reject any `PURGE_HOMES` id in the synced models: bad configuration fails
 *    the release before anything is written, so Helm aborts the upgrade and the old pods keep serving;
 * 2. with `RESET_PUBLIC` (staging, guarded by `ALLOW_DATABASE_RESET`), drop `public` and the
 *    drizzle journal; `media` and `userdata` are never touched;
 * 3. migrate `public`, `media` and `userdata`;
 * 4. sync the homes from git in one transaction (`syncHomes`). Nothing is deleted;
 *    then make each home's placements, opening overrides and notes match its seed, in one
 *    transaction (`syncSeeds`, history by `system` named `seed`); a home without a seed file is left alone;
 * 5. purge the homes named in `PURGE_HOMES` (a home that left git, e.g. the staging mock home):
 *    the stored home and its `userdata`, logged; photos are only listed, never deleted.
 */
export async function runRelease(
  database: Database,
  config: Pick<
    Config,
    'resetPublic' | 'allowDatabaseReset' | 'homeFiles' | 'purgeHomes' | 'userdataTrashRetentionDays'
  >,
  log: ReleaseLog,
  folder?: string,
): Promise<SyncReport & { seeds: SeedSyncReport }> {
  if (config.resetPublic && !config.allowDatabaseReset) {
    throw new Error('refusing to reset public: RESET_PUBLIC needs ALLOW_DATABASE_RESET=true');
  }
  const files = await homeFiles(config.homeFiles, folder);
  const models = await loadHomeFiles(files);
  log.info(`release: ${models.length} home file(s) valid: ${models.map((m) => m.id).join(', ')}`);
  const seeds: SeedInput[] = [];
  for (const [i, model] of models.entries()) {
    const seed = await readSeedFile(seedFileOf(files[i]!), model);
    if (seed) seeds.push({ model, seed });
    else {
      log.warn(
        `release: home "${model.id}" has no seed file; its placements, overrides and notes are left alone`,
      );
    }
  }
  if (seeds.length > 0) {
    log.info(
      `release: ${seeds.length} seed file(s) valid: ${seeds.map((s) => s.model.id).join(', ')}`,
    );
  }
  for (const id of config.purgeHomes) {
    if (models.some((m) => m.id === id)) {
      throw new Error(`refusing to purge home "${id}": it is in the synced files`);
    }
  }
  if (config.resetPublic) {
    await resetDatabase(database.db);
    log.info('release: public reset (media and userdata kept)');
  }
  await database.migrate();
  log.info(`release: migrations applied (${database.driver})`);
  const report = await syncHomes(
    database.db,
    { models },
    { retentionDays: config.userdataTrashRetentionDays },
  );
  const { info, warn } = describeSync(report);
  info.forEach((line) => log.info(line));
  warn.forEach((line) => log.warn(line));
  const seeded = await syncSeeds(database.db, seeds);
  describeSeedSync(seeded).forEach((line) => log.info(line));
  for (const id of config.purgeHomes) {
    const purged = await purgeHome(database.db, id);
    const rows = Object.entries(purged.removed)
      .map(([table, n]) => `${table}=${n}`)
      .join(' ');
    log.info(`release: purged home "${id}": ${rows}`);
    log.info(
      `release: home "${id}" keeps ${purged.photoIds.length} photo(s) and ${purged.photoRequests} photo request(s) (never deleted)` +
        (purged.photoIds.length > 0 ? `: ${purged.photoIds.join(', ')}` : ''),
    );
  }
  return { ...report, seeds: seeded };
}
