import type { Config } from '../config';
import type { Database } from './client';
import { describeImports, importLayouts, type LayoutImport } from './layout-import';
import { purgeHome } from './purge';
import { resetDatabase } from './reset';
import { describeSync, homeFiles, loadHomeFiles, syncHomes, type SyncReport } from './sync';

export interface ReleaseLog {
  info(line: string): void;
  warn(line: string): void;
}

/**
 * The pre-deploy hook (`dist/release.js`) on every environment:
 * 1. read and validate every home file: a bad one fails the release before anything is written,
 *    so Helm aborts the upgrade and the old pods keep serving;
 * 2. with `RESET_PUBLIC` (staging, guarded by `ALLOW_DATABASE_RESET`), drop `public` and the
 *    drizzle journal; `media` and `userdata` are never touched;
 * 3. migrate `public`, `media` and `userdata`;
 * 4. sync the homes from git in one transaction (`syncHomes`). Nothing is deleted;
 * 5. purge the homes named in `PURGE_HOMES` (a home that left git, e.g. the staging mock home):
 *    the stored home and its `userdata`, logged; photos are only listed, never deleted;
 * 6. import the named layouts once into the placement sets (`importLayouts`, #44).
 */
export async function runRelease(
  database: Database,
  config: Pick<
    Config,
    'resetPublic' | 'allowDatabaseReset' | 'homeFiles' | 'purgeHomes' | 'userdataTrashRetentionDays'
  >,
  log: ReleaseLog,
  folder?: string,
): Promise<SyncReport & { imports: LayoutImport[] }> {
  if (config.resetPublic && !config.allowDatabaseReset) {
    throw new Error('refusing to reset public: RESET_PUBLIC needs ALLOW_DATABASE_RESET=true');
  }
  const files = await homeFiles(config.homeFiles, folder);
  const models = await loadHomeFiles(files);
  log.info(`release: ${models.length} home file(s) valid: ${models.map((m) => m.id).join(', ')}`);
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
  for (const id of config.purgeHomes) {
    if (models.some((m) => m.id === id)) {
      throw new Error(`refusing to purge home "${id}": it is in the synced files`);
    }
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
  const imported = await importLayouts(database.db, {
    retentionDays: config.userdataTrashRetentionDays,
    warn: (line) => log.warn(line),
  });
  const lines = describeImports(imported);
  lines.info.forEach((line) => log.info(line));
  lines.warn.forEach((line) => log.warn(line));
  return { ...report, imports: imported };
}
