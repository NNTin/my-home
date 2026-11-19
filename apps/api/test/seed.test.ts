import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatSeed, HomeSeed, SeedSyncReport, seedIssues, type HomeModel } from '@my-home/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runRelease, type ReleaseLog } from '../src/db/release';
import { homes } from '../src/db/schema';
import { readHomeFile, seedHomes } from '../src/db/seed';
import { history, issuedIds, notes, placements } from '../src/db/userdata-schema';
import { homesFolder } from '../src/paths';
import { mockHomeFile, testSeedFiles } from './fixtures';
import { clearUserdata, createTestApp, injector } from './helpers';

const seedFile = join(homesFolder, 'home.seed.json');
const gitSeed = HomeSeed.parse(JSON.parse(await readFile(seedFile, 'utf8')));
const mockHome = await readHomeFile(mockHomeFile);
const agent = { 'x-my-home-actor': 'agent' };

describe('the seed (data/homes/<home>.seed.json)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let inject: ReturnType<typeof injector>;
  let lines: { info: string[]; warn: string[] };
  const log: ReleaseLog = {
    info: (line) => lines.info.push(line),
    warn: (line) => lines.warn.push(line),
  };
  const release = (folder?: string, homeFiles?: string[]) =>
    runRelease(
      ctx.database,
      {
        resetPublic: false,
        allowDatabaseReset: false,
        homeFiles,
        purgeHomes: [],
        userdataTrashRetentionDays: 30,
      },
      log,
      folder,
    );
  const exported = async (homeId = 'home') => {
    const res = await inject('GET', `/api/homes/${homeId}/seed`);
    expect(res.statusCode, res.body).toBe(200);
    return res.body;
  };
  const historyRows = (homeId = 'home') =>
    ctx.database.db.select().from(history).where(eq(history.homeId, homeId));

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

  it('a fresh database plus the seed exports the seed file byte for byte', async () => {
    await release();
    expect(await exported()).toBe(await readFile(seedFile, 'utf8'));
    expect(lines.info).toContain('release: 1 seed file(s) valid: home');
    const rows = await historyRows();
    expect(rows.length).toBe(gitSeed.placements.length + gitSeed.openingOverrides.length);
    // An actor the previous api can read: `system`, named `seed`.
    expect(
      rows.every(
        (r) => r.actor === 'system' && r.actorSource === 'default' && r.actorName === 'seed',
      ),
    ).toBe(true);
  });

  it('is idempotent: an unchanged seed changes nothing and writes no history', async () => {
    await release();
    const before = await historyRows();
    lines = { info: [], warn: [] };
    const report = await release();
    expect(lines.info).toContain('release: home "home" seed unchanged');
    expect(report.seeds.homes[0]!.placements).toEqual({
      created: [],
      updated: [],
      restored: [],
      removed: [],
    });
    expect((await historyRows()).length).toBe(before.length);
  });

  it('marks every seed id as issued, so the app never hands one out again', async () => {
    await release();
    const ids = (
      await ctx.database.db.select().from(issuedIds).where(eq(issuedIds.homeId, 'home'))
    ).map((r) => r.id);
    for (const p of gitSeed.placements) expect(ids).toContain(p.id);
    const cabinet = gitSeed.placements.find((p) => p.id === 'souterrain-tall-cabinet-1')!;
    const res = await inject(
      'POST',
      '/api/homes/home/placements',
      { typeId: cabinet.typeId, levelId: cabinet.levelId, position: cabinet.position },
      agent,
    );
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().id).toBe('souterrain-tall-cabinet-2');
  });

  it('replaces unexported edits on the next deploy, visible in history as seed changes', async () => {
    await release();
    const [first, second] = gitSeed.placements;
    const window = gitSeed.openingOverrides[0]!;
    // Edits nobody exported: a move, a new placement, a cleared override, a trashed seed
    // placement, a new override and a note.
    const p1 = (await inject('GET', '/api/homes/home/placements')).json().items;
    const version = (id: string) => p1.find((p: { id: string }) => p.id === id).version as number;
    await inject(
      'PATCH',
      `/api/homes/home/placements/${first!.id}`,
      {
        version: version(first!.id),
        position: { x: first!.position.x + 0.5, z: first!.position.z },
      },
      agent,
    );
    await inject(
      'DELETE',
      `/api/homes/home/placements/${second!.id}?version=${version(second!.id)}`,
      undefined,
      agent,
    );
    const extra = await inject(
      'POST',
      '/api/homes/home/placements',
      { typeId: 'furniture.bed', levelId: 'souterrain', position: { x: 10.8, z: -3.5 } },
      agent,
    );
    expect(extra.statusCode, extra.body).toBe(201);
    expect(
      (
        await inject(
          'PUT',
          `/api/homes/home/opening-overrides/${window.useId}`,
          { version: 1, params: {} },
          agent,
        )
      ).statusCode,
    ).toBe(200);
    const note = await inject(
      'POST',
      '/api/notes',
      { subject: { kind: 'use', id: window.useId }, homeId: 'home', body: 'Draft note' },
      agent,
    );
    expect(note.statusCode, note.body).toBe(201);
    expect(await exported()).not.toBe(formatSeed(gitSeed));

    lines = { info: [], warn: [] };
    const report = await release();
    expect(report.seeds.homes[0]).toEqual({
      homeId: 'home',
      placements: {
        created: [],
        updated: [first!.id],
        restored: [second!.id],
        removed: [extra.json().id],
      },
      openingOverrides: { set: [window.useId], cleared: [] },
      notes: { created: [], updated: [], deleted: [note.json().id] },
    });
    expect(lines.info.some((l) => l.startsWith('release: home "home" seed applied: '))).toBe(true);
    expect(await exported()).toBe(formatSeed(gitSeed));

    // Each change is the newest history entry of its use, by `seed`, and can be undone.
    for (const id of [first!.id, second!.id, extra.json().id, window.useId]) {
      const entries = (await inject('GET', `/api/homes/home/uses/${id}/history`)).json().items;
      expect(entries[0].actor, id).toBe('system');
      expect(entries[0].actorName, id).toBe('seed');
      expect(entries[0].canUndo, id).toBe(true);
    }
    const [trashed] = await ctx.database.db
      .select()
      .from(placements)
      .where(and(eq(placements.homeId, 'home'), eq(placements.id, extra.json().id)));
    expect(trashed!.removedAt).not.toBeNull();
    const [deleted] = await ctx.database.db
      .select()
      .from(notes)
      .where(eq(notes.id, note.json().id));
    expect(deleted!.deletedAt).not.toBeNull();
    expect(deleted!.updatedBy).toBe('system');
  });

  it('leaves a home without a seed file alone, with a warning', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'my-home-seed-'));
    await writeFile(join(dir, 'mock-home.json'), JSON.stringify(mockHome));
    await seedHomes(ctx.database.db, { files: testSeedFiles });
    const placed = await inject(
      'POST',
      '/api/homes/mock-home/placements',
      { typeId: 'furniture.bed', levelId: 'souterrain', position: { x: -3, z: 2.5 } },
      agent,
    );
    expect(placed.statusCode).toBe(201);
    const report = await release(dir);
    expect(report.seeds.homes).toEqual([]);
    expect(lines.warn).toContain(
      'release: home "mock-home" has no seed file; its placements, overrides and notes are left alone',
    );
    expect((await inject('GET', '/api/homes/mock-home/placements')).json().items).toHaveLength(1);
  });

  it('fails the release before writing anything when a seed does not fit its home', async () => {
    const bad = (seed: Partial<HomeSeed>) => ({ ...structuredClone(gitSeed), ...seed });
    const cases: [string, unknown, string][] = [
      [
        'unknown type',
        bad({ placements: [{ ...gitSeed.placements[0]!, typeId: 'furniture.nope' }] }),
        'not in the catalogue',
      ],
      [
        'unknown opening',
        bad({
          openingOverrides: [{ useId: 'window-nope', typeId: 'window.tilt-turn', params: {} }],
        }),
        'not in the home model',
      ],
      [
        'invalid param',
        bad({
          openingOverrides: [{ ...gitSeed.openingOverrides[0]!, params: { boardColor: 'red' } }],
        }),
        'boardColor',
      ],
      [
        'wrong type',
        bad({ openingOverrides: [{ ...gitSeed.openingOverrides[0]!, typeId: 'window.casement' }] }),
        'window.tilt-turn',
      ],
      [
        'unknown level',
        bad({ placements: [{ ...gitSeed.placements[0]!, levelId: 'cellar' }] }),
        'Level "cellar"',
      ],
      ['not JSON', 'nope', 'Cannot read seed file'],
    ];
    const home = JSON.parse(await readFile(join(homesFolder, 'home.json'), 'utf8')) as HomeModel;
    for (const [name, seed, message] of cases) {
      const dir = await mkdtemp(join(tmpdir(), 'my-home-seed-'));
      await writeFile(join(dir, 'home.json'), JSON.stringify(home));
      await writeFile(
        join(dir, 'home.seed.json'),
        typeof seed === 'string' ? seed : JSON.stringify(seed),
      );
      await expect(release(dir), name).rejects.toThrow(message);
      expect(await ctx.database.db.select().from(homes), name).toEqual([]);
    }
  });

  describe('export and import (GET/PUT /api/homes/:homeId/seed)', () => {
    beforeEach(() => seedHomes(ctx.database.db, { files: testSeedFiles }));

    it('round trip: export → import into a fresh database → export is identical', async () => {
      const bed = await inject(
        'POST',
        '/api/homes/mock-home/placements',
        {
          typeId: 'furniture.bed',
          levelId: 'souterrain',
          position: { x: -3, z: 2.5 },
          rotationY: 0.3,
          params: { width: 1.8, color: '#AABBCC' },
        },
        agent,
      );
      expect(bed.statusCode, bed.body).toBe(201);
      // On a wall and under the ceiling (#63): their mounting and elevation go through the seed.
      for (const body of [
        {
          typeId: 'kitchen.wall-cabinet',
          position: { x: 3, z: -3.675 },
          elevation: 1.4,
        },
        { typeId: 'fixture.downlight', position: { x: 3, z: -2 } },
      ]) {
        const res = await inject(
          'POST',
          '/api/homes/mock-home/placements',
          { levelId: 'souterrain', rotationY: 0, ...body },
          agent,
        );
        expect(res.statusCode, res.body).toBe(201);
      }
      await inject(
        'PUT',
        '/api/homes/mock-home/opening-overrides/souterrain-kitchen-window',
        { version: 0, params: { frameColor: '#383E42', sashes: 2 } },
        agent,
      );
      for (const body of [
        { subject: { kind: 'use', id: bed.json().id }, homeId: 'mock-home', body: 'Guest bed' },
        {
          subject: { kind: 'use', id: 'souterrain-kitchen-window' },
          homeId: 'mock-home',
          body: 'Sticks',
        },
        { subject: { kind: 'type', id: 'window.casement' }, body: 'All replaced in 2019' },
      ]) {
        expect((await inject('POST', '/api/notes', body, agent)).statusCode).toBe(201);
      }
      const first = await exported('mock-home');
      const seed = HomeSeed.parse(JSON.parse(first));
      expect(first).toBe(formatSeed(seed));
      expect(seed.placements.map((p) => [p.typeId, p.mounting, p.elevation])).toEqual([
        ['furniture.bed', undefined, undefined],
        ['fixture.downlight', 'ceiling', undefined],
        ['kitchen.wall-cabinet', 'wall', 1.4],
      ]);
      expect(seed.openingOverrides).toEqual([
        {
          useId: 'souterrain-kitchen-window',
          typeId: 'window.casement',
          params: { frameColor: '#383e42', sashes: 2 },
        },
      ]);
      // Type notes first, then by subject and creation.
      expect(seed.notes.map((n) => n.body)).toEqual([
        'All replaced in 2019',
        'Guest bed',
        'Sticks',
      ]);

      await clearUserdata(ctx);
      const imported = await inject('PUT', '/api/homes/mock-home/seed', seed, agent);
      expect(imported.statusCode, imported.body).toBe(200);
      expect(imported.headers.warning).toMatch(/next deploy/);
      const report = SeedSyncReport.parse(imported.json());
      expect(report.homes[0]!.placements.created).toEqual(seed.placements.map((p) => p.id));
      const placed = (await inject('GET', '/api/homes/mock-home/placements')).json().items;
      expect(
        placed.map((p: { mounting: string; elevation: number }) => [p.mounting, p.elevation]),
      ).toEqual(
        expect.arrayContaining([
          ['floor', 0],
          ['wall', 1.4],
          ['ceiling', 0],
        ]),
      );
      expect(report.typeNotes.created).toHaveLength(1);
      expect(await exported('mock-home')).toBe(first);

      // Again: nothing changes, no history.
      const rows = (await historyRows('mock-home')).length;
      const again = SeedSyncReport.parse(
        (await inject('PUT', '/api/homes/mock-home/seed', seed, agent)).json(),
      );
      expect(again.homes[0]!.placements.created).toEqual([]);
      expect(again.homes[0]!.openingOverrides.set).toEqual([]);
      expect(again.typeNotes).toEqual({ created: [], updated: [], deleted: [] });
      expect((await historyRows('mock-home')).length).toBe(rows);
      // The import records who sent it, as the seed.
      const entries = (
        await inject('GET', `/api/homes/mock-home/uses/${bed.json().id}/history`)
      ).json().items;
      expect(entries[0]).toMatchObject({
        actor: 'system',
        actorSource: 'default',
        actorName: 'seed import by agent',
        action: 'create',
      });
    });

    it('a note on a placement in the trash is outside the seed: not exported, kept by a sync', async () => {
      const bed = await inject(
        'POST',
        '/api/homes/mock-home/placements',
        { typeId: 'furniture.bed', levelId: 'souterrain', position: { x: -3, z: 2.5 } },
        agent,
      );
      expect(bed.statusCode, bed.body).toBe(201);
      const note = await inject(
        'POST',
        '/api/notes',
        { subject: { kind: 'use', id: bed.json().id }, homeId: 'mock-home', body: 'Guest bed' },
        agent,
      );
      expect(note.statusCode, note.body).toBe(201);
      const trashed = await inject(
        'DELETE',
        `/api/homes/mock-home/placements/${bed.json().id}?version=1`,
        undefined,
        agent,
      );
      expect(trashed.statusCode, trashed.body).toBe(200);

      const first = await exported('mock-home');
      const seed = HomeSeed.parse(JSON.parse(first));
      expect(seed.placements).toEqual([]);
      expect(seed.notes).toEqual([]);
      expect(seedIssues(seed, mockHome)).toEqual([]);
      // Export → import → export: valid, identical, and the note survives (it is not in scope).
      const imported = await inject('PUT', '/api/homes/mock-home/seed', seed, agent);
      expect(imported.statusCode, imported.body).toBe(200);
      expect(SeedSyncReport.parse(imported.json()).homes[0]!.notes.deleted).toEqual([]);
      expect(await exported('mock-home')).toBe(first);
      const [kept] = await ctx.database.db.select().from(notes).where(eq(notes.id, note.json().id));
      expect(kept!.deletedAt).toBeNull();
      // Restored, the bed and its note are exported again.
      await inject(
        'POST',
        `/api/homes/mock-home/placements/${bed.json().id}/restore`,
        undefined,
        agent,
      );
      const restored = HomeSeed.parse(JSON.parse(await exported('mock-home')));
      expect(restored.notes.map((n) => n.id)).toEqual([note.json().id]);
      expect(seedIssues(restored, mockHome)).toEqual([]);
    });

    it('normalises params the way the api stores them', async () => {
      const seed = {
        schemaVersion: 1,
        homeId: 'mock-home',
        placements: [],
        openingOverrides: [
          {
            useId: 'souterrain-kitchen-window',
            typeId: 'window.casement',
            params: { frameColor: '#383E42' },
          },
        ],
        notes: [],
      };
      expect((await inject('PUT', '/api/homes/mock-home/seed', seed, agent)).statusCode).toBe(200);
      expect(
        HomeSeed.parse(JSON.parse(await exported('mock-home'))).openingOverrides[0]!.params,
      ).toEqual({
        frameColor: '#383e42',
      });
    });

    it('refuses a seed that does not fit the home: 400 with the issues', async () => {
      const res = await inject(
        'PUT',
        '/api/homes/mock-home/seed',
        {
          schemaVersion: 1,
          homeId: 'mock-home',
          placements: [],
          openingOverrides: [{ useId: 'nope', typeId: 'window.casement', params: {} }],
          notes: [],
        },
        agent,
      );
      expect(res.statusCode).toBe(400);
      expect(res.json().issues[0].path).toBe('openingOverrides[0].useId');
      expect((await inject('GET', '/api/homes/nope/seed')).statusCode).toBe(404);
    });
  });
});
