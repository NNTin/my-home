import { ListHistoryResponse, ListPlacementsResponse, type LayoutItem } from '@my-home/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importedParams, importedTypeId, importLayouts } from '../src/db/layout-import';
import { runRelease, type ReleaseLog } from '../src/db/release';
import { homes, layouts } from '../src/db/schema';
import { imports } from '../src/db/userdata-schema';
import { clearUserdata, createTestApp, injector } from './helpers';

const item = (overrides: Partial<LayoutItem> = {}): LayoutItem => ({
  id: 'i1',
  typeId: 'bed',
  levelId: 'souterrain',
  roomId: 'souterrain-bedroom',
  position: { x: -3, z: 2.5 },
  rotationY: 0,
  props: {},
  ...overrides,
});

describe('the one-time layout import (release job)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let inject: ReturnType<typeof injector>;
  let lines: { info: string[]; warn: string[] };
  const log: ReleaseLog = {
    info: (line) => lines.info.push(line),
    warn: (line) => lines.warn.push(line),
  };
  const release = () =>
    runRelease(
      ctx.database,
      {
        resetPublic: false,
        allowDatabaseReset: false,
        homeFiles: ['mock-home.json'],
        userdataTrashRetentionDays: 30,
      },
      log,
    );
  const addLayout = (id: string, name: string, items: LayoutItem[], updatedAt: string) =>
    ctx.database.db.insert(layouts).values({
      id,
      homeId: 'mock-home',
      name,
      schemaVersion: 1,
      items,
      createdAt: new Date(updatedAt),
      updatedAt: new Date(updatedAt),
    });
  const placements = async () =>
    ListPlacementsResponse.parse(
      (await inject('GET', '/api/homes/mock-home/placements?include=removed')).json(),
    ).items;

  beforeAll(async () => {
    ctx = await createTestApp();
    inject = injector(ctx);
  });
  beforeEach(async () => {
    lines = { info: [], warn: [] };
    await ctx.database.db.delete(homes); // cascades to the layouts
    await clearUserdata(ctx);
    await release(); // the home must exist before a layout can reference it
    lines = { info: [], warn: [] };
  });
  afterAll(() => ctx.app.close());

  it('imports the most recently updated layout once, as system, and leaves the layouts', async () => {
    await addLayout('old', 'Old layout', [item({ typeId: 'sofa' })], '2026-01-01T00:00:00Z');
    await addLayout(
      'new',
      'Default layout',
      [
        item({ props: { color: '#336699', width: 1.8 } }),
        item({ id: 'i2', typeId: 'table', position: { x: 3, z: -2 }, rotationY: 1.5 }),
      ],
      '2026-02-01T00:00:00Z',
    );
    const report = await release();

    expect(report.imports).toEqual([
      {
        homeId: 'mock-home',
        status: 'imported',
        layoutId: 'new',
        layoutName: 'Default layout',
        items: 2,
        droppedParams: [],
      },
    ]);
    expect(lines.info).toContain(
      'release: home "mock-home": imported layout "Default layout" (2 items)',
    );
    const placed = await placements();
    expect(placed).toMatchObject([
      {
        id: 'souterrain-bed-1',
        typeId: 'furniture.bed',
        name: 'Bedroom · Bed',
        roomId: 'souterrain-bedroom',
        position: { x: -3, z: 2.5 },
        params: { color: '#336699', width: 1.8 },
        removedAt: null,
      },
      {
        id: 'souterrain-table-1',
        typeId: 'furniture.table',
        rotationY: 1.5,
        name: 'Kitchen · Round table',
      },
    ]);
    const history = ListHistoryResponse.parse(
      (await inject('GET', '/api/homes/mock-home/uses/souterrain-bed-1/history')).json(),
    ).items;
    expect(history).toMatchObject([
      { action: 'import', actor: 'system', actorSource: 'default', before: null },
    ]);
    const [row] = await ctx.database.db
      .select()
      .from(imports)
      .where(eq(imports.homeId, 'mock-home'));
    expect(row).toMatchObject({ source: 'layouts', detail: { status: 'imported', items: 2 } });
    expect(row?.detail.placementIds).toEqual(['souterrain-bed-1', 'souterrain-table-1']);
    // The layouts stay in public (the previous api version still reads them).
    expect(await ctx.database.db.select({ id: layouts.id }).from(layouts)).toHaveLength(2);

    // Idempotent: the next deploy imports nothing, even once everything is in the trash.
    lines = { info: [], warn: [] };
    for (const p of placed) {
      await inject('DELETE', `/api/homes/mock-home/placements/${p.id}?version=${p.version}`);
    }
    expect((await release()).imports).toEqual([]);
    expect(lines.info.some((l) => l.includes('imported layout'))).toBe(false);
    expect(await placements()).toHaveLength(2);
  });

  it('is skipped when the home already has placements (trashed ones too)', async () => {
    const placed = await inject('POST', '/api/homes/mock-home/placements', {
      typeId: 'furniture.chair',
      levelId: 'souterrain',
      position: { x: -3, z: 2.5 },
    });
    const { id, version } = placed.json<{ id: string; version: number }>();
    await inject('DELETE', `/api/homes/mock-home/placements/${id}?version=${version}`);
    await addLayout('l', 'Default layout', [item()], '2026-02-01T00:00:00Z');

    const report = await importLayouts(ctx.database.db, { retentionDays: 30 });
    expect(report).toMatchObject([{ status: 'skipped', reason: 'placements exist', items: 0 }]);
    expect((await placements()).map((p) => p.id)).toEqual(['souterrain-chair-1']);
    // Recorded: it does not run once the trash is purged either.
    expect(await importLayouts(ctx.database.db, { retentionDays: 30 })).toEqual([]);
  });

  it('maps legacy types, keeps unknown ones and gone levels, and drops invalid props', async () => {
    await addLayout(
      'l',
      'Default layout',
      [
        item({ props: { color: 'red', width: 1.8, glow: true } }),
        item({ id: 'i2', typeId: 'lamp', props: { shade: 'blue', on: true } }),
        item({ id: 'i3', typeId: 'desk', levelId: 'cellar', position: { x: 0, z: 0 } }),
      ],
      '2026-02-01T00:00:00Z',
    );
    const [report] = (await release()).imports;
    expect(report?.droppedParams).toEqual(['i1.color', 'i1.glow', 'i2.on']);
    expect(lines.warn).toContain(
      'release: home "mock-home": dropped invalid layout props: i1.color, i1.glow, i2.on',
    );
    // One transaction, one createdAt: listed by id.
    expect(await placements()).toMatchObject([
      { id: 'cellar-desk-1', levelId: 'cellar', roomId: null, name: 'cellar · Desk' },
      { id: 'souterrain-bed-1', typeId: 'furniture.bed', params: { width: 1.8 } },
      { id: 'souterrain-lamp-1', typeId: 'furniture.lamp', params: { shade: 'blue' } },
    ]);
    const uses = (await inject('GET', '/api/homes/mock-home/uses?status=needs-attention')).json<{
      items: { id: string; problems: string[] }[];
    }>().items;
    expect(uses.map((u) => u.id)).toEqual(
      expect.arrayContaining(['souterrain-lamp-1', 'cellar-desk-1']),
    );
  });

  it('warns about a home whose stored model is invalid and retries it later', async () => {
    await addLayout('l', 'Default layout', [item()], '2026-02-01T00:00:00Z');
    const [stored] = await ctx.database.db.select().from(homes).where(eq(homes.id, 'mock-home'));
    await ctx.database.db
      .update(homes)
      .set({ model: { ...stored!.model, levels: [] } })
      .where(eq(homes.id, 'mock-home'));
    const warnings: string[] = [];
    expect(
      await importLayouts(ctx.database.db, { retentionDays: 30, warn: (l) => warnings.push(l) }),
    ).toEqual([]);
    expect(warnings).toEqual([
      expect.stringMatching(
        /^release: home "mock-home": layouts not imported, its stored model is invalid \(.+\); retried on the next run$/,
      ),
    ]);
    expect(await ctx.database.db.select().from(imports)).toEqual([]);
    // Once the sync has put a valid model back, it is imported.
    await release();
    expect(await placements()).toHaveLength(1);
  });

  it('maps type ids and params', () => {
    expect(importedTypeId('wardrobe')).toBe('furniture.wardrobe');
    expect(importedTypeId('Lamp_2')).toBe('furniture.unknown');
    expect(importedParams('furniture.bed', { width: 9, color: '#aabbcc' })).toEqual({
      params: { color: '#aabbcc' },
      dropped: ['width'],
    });
  });
});
