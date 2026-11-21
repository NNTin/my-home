import {
  formatSeed,
  HomeModel,
  HomeSeed,
  normalizeSeed,
  seedIssues,
  type SeedNote,
} from '@my-home/shared';
import { PgSelectBuilder, type PgTable } from 'drizzle-orm/pg-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { homeStore } from '../src/db/homes';
import { homes } from '../src/db/schema';
import { readHomeFile, seedHomes } from '../src/db/seed';
import { history, notes, openingOverrides, placements } from '../src/db/userdata-schema';
import { mockHomeFile, testSeedFiles } from './fixtures';
import { clearUserdata, createTestApp, injector } from './helpers';

const modelA = await readHomeFile(mockHomeFile);
const openingId = 'souterrain-kitchen-window';
const timestamp = '2026-01-01T00:00:00.000Z';
const note = (id: string, subject: SeedNote['subject'], body: string): SeedNote => ({
  id,
  subject,
  body,
  createdBy: 'agent',
  updatedBy: 'agent',
  createdAt: timestamp,
  updatedAt: timestamp,
});

const seed = (version: 'a' | 'b', useId = openingId): HomeSeed =>
  normalizeSeed({
    schemaVersion: 1,
    homeId: modelA.id,
    placements: [
      {
        id: `snapshot-bed-${version}`,
        typeId: 'furniture.bed',
        name: `Bed ${version}`,
        levelId: 'souterrain',
        position: { x: -3, z: 2.5 },
        rotationY: 0,
        params: { width: version === 'a' ? 1.6 : 1.8 },
      },
    ],
    openingOverrides: [
      {
        useId,
        typeId: 'window.casement',
        params: { frameColor: version === 'a' ? '#ffffff' : '#383e42' },
      },
    ],
    notes: [
      note('10000000-0000-4000-8000-000000000001', { kind: 'type', id: 'furniture.bed' }, version),
      note(
        version === 'a'
          ? '10000000-0000-4000-8000-000000000002'
          : '10000000-0000-4000-8000-000000000003',
        { kind: 'use', id: `snapshot-bed-${version}` },
        `Use note ${version}`,
      ),
      note(
        '10000000-0000-4000-8000-000000000004',
        { kind: 'use', id: useId },
        `Opening ${version}`,
      ),
    ],
  });

/** Pause once after a real SELECT finishes, before its result reaches the export's next read. */
function afterSelect(table: PgTable, paused: () => Promise<void>) {
  const from = PgSelectBuilder.prototype.from;
  const spy = vi.spyOn(PgSelectBuilder.prototype, 'from').mockImplementation(function (
    this: PgSelectBuilder<undefined>,
    source,
  ) {
    const query = from.call(this, source);
    if (source === table) {
      // Only database-backed SELECTs reach this helper, not standalone SQL query builders.
      const executable = query as { execute: () => Promise<unknown[]> };
      const execute = executable.execute.bind(query);
      vi.spyOn(executable, 'execute').mockImplementationOnce(async () => {
        const rows = await execute();
        spy.mockRestore(); // The concurrent import must not hit the pause too.
        await paused();
        return rows;
      });
    }
    return query;
  });
  return spy;
}

describe('seed export snapshot', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let inject: ReturnType<typeof injector>;
  const seedA = seed('a');
  const imported = async (value: HomeSeed) => {
    const res = await inject('PUT', `/api/homes/${modelA.id}/seed`, value, {
      'x-my-home-actor': 'agent',
    });
    expect(res.statusCode, res.body).toBe(200);
  };
  const exported = () => inject('GET', `/api/homes/${modelA.id}/seed`);
  const stored = async () => [
    await ctx.database.db.select().from(homes),
    await ctx.database.db.select().from(placements),
    await ctx.database.db.select().from(openingOverrides),
    await ctx.database.db.select().from(notes),
    await ctx.database.db.select().from(history),
  ];

  beforeAll(async () => {
    ctx = await createTestApp();
    inject = injector(ctx);
  });
  beforeEach(async () => {
    await ctx.database.db.delete(homes);
    await clearUserdata(ctx);
    await seedHomes(ctx.database.db, { files: testSeedFiles });
    expect(seedIssues(seedA, modelA)).toEqual([]);
    await imported(seedA);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => ctx.app.close());

  it('is read-only and keeps unchanged exports canonical and byte-for-byte stable', async () => {
    const before = await stored();
    const transaction = vi.spyOn(ctx.database.db, 'transaction');
    let paused = false;
    afterSelect(homes, async () => {
      paused = true;
    });
    for (let i = 0; i < 2; i++) {
      const res = await exported();
      expect(res.statusCode, res.body).toBe(200);
      expect(res.body).toBe(formatSeed(seedA));
    }
    expect(paused).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    });
    expect(await stored()).toEqual(before);
  });

  for (const component of ['model', 'placements'] as const) {
    it.skipIf(!process.env.DATABASE_URL)(
      `keeps the complete pre-import snapshot when an import commits after reading ${component}`,
      async () => {
        // Renaming a synthetic opening makes a model/data mismatch observable through noteScope
        // and semantic validation. No house geometry or real home data is changed.
        const modelB = HomeModel.parse(
          JSON.parse(JSON.stringify(modelA).replaceAll(openingId, `${openingId}-b`)),
        );
        const nextModel = component === 'model' ? modelB : modelA;
        const seedB = seed('b', component === 'model' ? `${openingId}-b` : openingId);
        expect(seedIssues(seedB, nextModel)).toEqual([]);
        let committed = false;
        afterSelect(component === 'model' ? homes : placements, async () => {
          if (component === 'model') {
            expect(await homeStore(ctx.database.db).replace(nextModel)).toBe(true);
          }
          // A separate pool connection commits the atomic seed import while the reader is paused.
          await imported(seedB);
          committed = true;
        });

        const res = await exported();
        expect(committed).toBe(true);
        expect(res.statusCode, res.body).toBe(200);
        const snapshot = HomeSeed.parse(res.json());
        // Full equality catches mixed overrides/type notes and silently omitted new use notes;
        // semantic validation alone would not catch all of those cases.
        expect(snapshot).toEqual(seedA);
        expect(res.body).toBe(formatSeed(seedA));
        expect(seedIssues(snapshot, modelA)).toEqual([]);
        expect(snapshot.notes).toEqual(seedA.notes);
        expect(await homeStore(ctx.database.db).get(modelA.id)).toEqual(nextModel);

        const next = await exported();
        expect(next.statusCode, next.body).toBe(200);
        expect(next.body).toBe(formatSeed(seedB));
        expect(seedIssues(HomeSeed.parse(next.json()), nextModel)).toEqual([]);
        expect(HomeSeed.parse(next.json()).notes).toEqual(seedB.notes);
      },
    );
  }
});
