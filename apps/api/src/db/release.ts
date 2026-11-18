import type { Config } from '../config';
import type { Database } from './client';
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
 * 4. sync the homes from git in one transaction (`syncHomes`). Nothing is deleted.
 */
export async function runRelease(
  database: Database,
  config: Pick<
    Config,
    'resetPublic' | 'allowDatabaseReset' | 'homeFiles' | 'userdataTrashRetentionDays'
  >,
  log: ReleaseLog,
  folder?: string,
): Promise<SyncReport> {
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
  return report;
}
