import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HomeModel } from '@my-home/shared';
import { asc } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runRelease, type ReleaseLog } from '../src/db/release';
import { homes } from '../src/db/schema';
import { readHomeFile } from '../src/db/seed';
import { homeFiles } from '../src/db/sync';
import { homesFolder } from '../src/paths';
import { mockHomeFile } from './fixtures';
import { clearMedia, clearUserdata, createTestApp, injector } from './helpers';

const mockHome = await readHomeFile(mockHomeFile);
const seedPlacements = (
  JSON.parse(await readFile(join(homesFolder, 'home.seed.json'), 'utf8')) as { placements: [] }
).placements.length;
const WINDOW = 'souterrain-kitchen-window';

/** A data/homes folder with the given files. */
async function folderWith(files: Record<string, unknown>) {
  const dir = await mkdtemp(join(tmpdir(), 'my-home-release-'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), JSON.stringify(content));
  }
  return dir;
}

const variant = (overrides: Partial<HomeModel>): HomeModel => ({
  ...structuredClone(mockHome),
  ...overrides,
});

describe('the release job (dist/release.js)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let inject: ReturnType<typeof injector>;
  let lines: { info: string[]; warn: string[] };
  const log: ReleaseLog = {
    info: (line) => lines.info.push(line),
    warn: (line) => lines.warn.push(line),
  };
  const config = (
    overrides: Partial<Parameters<typeof runRelease>[1]> = {},
  ): Parameters<typeof runRelease>[1] => ({
    resetPublic: false,
    allowDatabaseReset: false,
    homeFiles: undefined,
    purgeHomes: [],
    userdataTrashRetentionDays: 30,
    ...overrides,
  });
  const stored = () =>
    ctx.database.db
      .select({
        id: homes.id,
        name: homes.name,
        created_at: homes.createdAt,
        updated_at: homes.updatedAt,
      })
      .from(homes)
      .orderBy(asc(homes.createdAt), asc(homes.id));

  beforeAll(async () => {
    ctx = await createTestApp();
    inject = injector(ctx);
  });
  beforeEach(async () => {
    lines = { info: [], warn: [] };
    await ctx.database.db.delete(homes);
    await clearUserdata(ctx);
  });
  afterAll(() => ctx.app.close());

  it('syncs every data/homes file, home.json first: only "Our home"', async () => {
    expect((await homeFiles(undefined)).map((f) => f.slice(homesFolder.length + 1))).toEqual([
      'home.json',
    ]);
    const report = await runRelease(ctx.database, config(), log);
    expect(report.homes.map((h) => [h.id, h.status])).toEqual([['home', 'inserted']]);
    expect(
      (await inject('GET', '/api/homes')).json().items.map((h: { id: string }) => h.id),
    ).toEqual(['home']);
    expect(lines.info).toContain('release: home "home" inserted, 0 uses need attention');
  });

  it('inserts on the first run, replaces on the next and keeps createdAt', async () => {
    const first = await folderWith({ 'mock-home.json': mockHome });
    await runRelease(ctx.database, config(), log, first);
    const [before] = await stored();

    // The same file again changes nothing.
    const again = await runRelease(ctx.database, config(), log, first);
    expect(again.homes[0]!.status).toBe('unchanged');
    expect((await stored())[0]!.updated_at).toEqual(before!.updated_at);

    const renamed = await folderWith({ 'mock-home.json': variant({ name: 'Renamed' }) });
    const report = await runRelease(ctx.database, config(), log, renamed);
    expect(report.homes[0]!.status).toBe('replaced');
    const [after] = await stored();
    expect(after!.name).toBe('Renamed');
    expect(after!.created_at).toEqual(before!.created_at);
    expect(after!.updated_at.getTime()).toBeGreaterThanOrEqual(before!.updated_at.getTime());
    expect(lines.info).toContain('release: home "mock-home" replaced, 0 uses need attention');
  });

  it('aborts on an invalid file before writing anything', async () => {
    const valid = await folderWith({ 'mock-home.json': mockHome });
    await runRelease(ctx.database, config(), log, valid);
    const before = await stored();

    const broken = await folderWith({
      'a.json': variant({ id: 'a', name: 'Changed' }),
      'mock-home.json': variant({ name: 'Changed' }),
      'z.json': { schemaVersion: 1, id: 'z' },
    });
    await expect(runRelease(ctx.database, config(), log, broken)).rejects.toThrow(
      /Invalid home file .*z\.json/,
    );
    expect(await stored()).toEqual(before);

    // Even a staging reset does not happen.
    await expect(
      runRelease(
        ctx.database,
        config({ resetPublic: true, allowDatabaseReset: true }),
        log,
        broken,
      ),
    ).rejects.toThrow(/Invalid home file/);
    expect(await stored()).toEqual(before);

    const duplicate = await folderWith({ 'a.json': mockHome, 'b.json': mockHome });
    await expect(runRelease(ctx.database, config(), log, duplicate)).rejects.toThrow(
      /Home id "mock-home" is in both/,
    );
    expect(await stored()).toEqual(before);
  });

  it('syncs only HOME_FILES when set (production: home.json)', async () => {
    const report = await runRelease(ctx.database, config({ homeFiles: ['home.json'] }), log);
    expect(report.homes.map((h) => h.id)).toEqual(['home']);
    expect((await stored()).map((h) => h.id)).toEqual(['home']);
  });

  it('leaves a home that is not in git alone, with a warning', async () => {
    const other = variant({ id: 'other-home', name: 'Other home' });
    expect((await inject('POST', '/api/homes/import', other)).statusCode).toBe(201);
    const report = await runRelease(ctx.database, config({ homeFiles: [mockHomeFile] }), log);
    expect(report.notInGit).toEqual(['other-home']);
    expect((await stored()).map((h) => h.id).sort()).toEqual(['mock-home', 'other-home']);
    expect(lines.warn).toContain(
      'release: home "other-home" is stored but not in the synced files; left alone',
    );
  });

  it('purges a retired home and its userdata, never photos, and nothing of another home', async () => {
    await clearMedia(ctx);
    await runRelease(ctx.database, config({ homeFiles: [mockHomeFile, 'home.json'] }), log);
    const bed = { typeId: 'furniture.bed', levelId: 'souterrain', roomId: 'souterrain-bedroom' };
    const place = (home: string) =>
      inject('POST', `/api/homes/${home}/placements`, { ...bed, position: { x: 0, z: 0 } });
    expect((await place('mock-home')).statusCode).toBe(201);
    expect((await place('home')).statusCode).toBe(201);
    const request = await inject('POST', '/api/homes/mock-home/photo-requests', {
      levelId: 'souterrain',
      roomId: 'souterrain-kitchen',
      reason: 'purge test',
    });
    expect(request.statusCode).toBe(201);
    lines = { info: [], warn: [] };

    await runRelease(
      ctx.database,
      config({ homeFiles: ['home.json'], purgeHomes: ['mock-home'] }),
      log,
    );

    expect(lines.info.find((l) => l.startsWith('release: purged home "mock-home"'))).toMatch(
      /userdata\.placements=1 .*public\.homes=1/,
    );
    expect(lines.info).toContain(
      'release: home "mock-home" keeps 0 photo(s) and 1 photo request(s) (never deleted)',
    );
    expect((await stored()).map((h) => h.id)).toEqual(['home']);
    // "home" keeps its placements: the seed's, and the unexported one in the trash (the seed
    // sync moved it there).
    const kept = (await inject('GET', '/api/homes/home/placements?include=removed')).json().items;
    expect(kept).toHaveLength(seedPlacements + 1);
    expect(kept.filter((p: { removedAt: string | null }) => p.removedAt !== null)).toHaveLength(1);
    expect((await inject('GET', `/api/photo-requests/${request.json().id}`)).statusCode).toBe(200);
    await clearMedia(ctx);
  });

  it('refuses to purge a home that is synced', async () => {
    await expect(
      runRelease(ctx.database, config({ homeFiles: ['home.json'], purgeHomes: ['home'] }), log),
    ).rejects.toThrow(/refusing to purge home "home"/);
  });

  it('refuses RESET_PUBLIC without ALLOW_DATABASE_RESET', async () => {
    await expect(runRelease(ctx.database, config({ resetPublic: true }), log)).rejects.toThrow(
      /ALLOW_DATABASE_RESET/,
    );
  });

  it('with RESET_PUBLIC, resets public and keeps media, userdata and the settings', async () => {
    await clearMedia(ctx);
    await runRelease(ctx.database, config({ homeFiles: [mockHomeFile] }), log);
    await inject('PUT', `/api/homes/mock-home/opening-overrides/${WINDOW}`, {
      version: 0,
      params: { frameColor: '#383e42' },
    });
    const declination = { value: 2.5, source: 'estimated-from-photo' };
    expect(
      (
        await inject('PUT', '/api/homes/mock-home/settings', {
          version: 0,
          magneticDeclination: declination,
        })
      ).statusCode,
    ).toBe(200);
    const request = await inject('POST', '/api/homes/mock-home/photo-requests', {
      levelId: 'souterrain',
      roomId: 'souterrain-kitchen',
      reason: 'release test',
    });
    expect(request.statusCode, request.body).toBe(201);

    await runRelease(
      ctx.database,
      config({ resetPublic: true, allowDatabaseReset: true, homeFiles: [mockHomeFile] }),
      log,
    );
    expect(lines.info).toContain('release: public reset (media and userdata kept)');
    const overrides = (await inject('GET', '/api/homes/mock-home/opening-overrides')).json();
    expect(overrides.items.map((o: { useId: string }) => o.useId)).toEqual([WINDOW]);
    expect((await inject('GET', '/api/homes/mock-home/settings')).json()).toMatchObject({
      version: 1,
      magneticDeclination: declination,
    });
    const model = (await inject('GET', '/api/homes/mock-home')).json();
    expect(model.building.magneticDeclination).toEqual(declination);
    expect((await inject('GET', `/api/photo-requests/${request.json().id}`)).json().reason).toBe(
      'release test',
    );
    await clearMedia(ctx);
  });

  it('reports an override whose opening left git as needing attention, and keeps it', async () => {
    const withWindow = await folderWith({ 'mock-home.json': mockHome });
    await runRelease(ctx.database, config(), log, withWindow);
    const put = await inject('PUT', `/api/homes/mock-home/opening-overrides/${WINDOW}`, {
      version: 0,
      params: { frameColor: '#383e42' },
    });
    expect(put.statusCode, put.body).toBe(200);

    const without = await folderWith({
      'mock-home.json': variant({ openings: mockHome.openings.filter((o) => o.id !== WINDOW) }),
    });
    const report = await runRelease(ctx.database, config(), log, without);
    expect(report.homes[0]).toEqual({
      id: 'mock-home',
      status: 'replaced',
      needsAttention: [WINDOW],
    });
    expect(lines.info).toContain(
      `release: home "mock-home" replaced, 1 use needs attention: ${WINDOW}`,
    );
    const uses = (await inject('GET', '/api/homes/mock-home/uses?status=needs-attention')).json();
    expect(uses.items).toMatchObject([{ id: WINDOW, where: 'not in the home model' }]);
    const overrides = (await inject('GET', '/api/homes/mock-home/opening-overrides')).json();
    expect(overrides.items).toMatchObject([{ useId: WINDOW, params: { frameColor: '#383e42' } }]);
  });
});
