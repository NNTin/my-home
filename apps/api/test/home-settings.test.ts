import { HistoryEntry, HomeSettings } from '@my-home/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { homes } from '../src/db/schema';
import { seed } from '../src/db/seed';
import { clearUserdata, createTestApp, injector } from './helpers';
import { mockHomeFile } from './fixtures';

const URL = '/api/homes/mock-home/settings';
const measured = { value: 2.5, source: 'estimated-from-photo' } as const;

describe('home settings (the declination overlay)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let inject: ReturnType<typeof injector>;
  beforeAll(async () => {
    ctx = await createTestApp();
    inject = injector(ctx);
  });
  beforeEach(async () => {
    await ctx.database.db.delete(homes);
    await clearUserdata(ctx);
    await seed(ctx.database.db, { file: mockHomeFile });
  });
  afterAll(() => ctx.app.close());

  const put = (version: number, magneticDeclination: unknown) =>
    inject('PUT', URL, { version, magneticDeclination }, { 'x-my-home-actor': 'agent' });
  const history = async () =>
    (await inject('GET', '/api/homes/mock-home/uses/mock-home/history')).json()
      .items as HistoryEntry[];

  it('starts unset at version 0, and 404s for an unknown home', async () => {
    const res = await inject('GET', URL);
    expect(res.statusCode).toBe(200);
    expect(HomeSettings.parse(res.json())).toEqual({
      homeId: 'mock-home',
      magneticDeclination: null,
      version: 0,
      updatedAt: null,
    });
    expect((await inject('GET', '/api/homes/nope/settings')).statusCode).toBe(404);
    expect(
      (await inject('PUT', '/api/homes/nope/settings', { version: 0, magneticDeclination: null }))
        .statusCode,
    ).toBe(404);
  });

  it('sets the declination, records history, and 409s on a stale version', async () => {
    const res = await put(0, measured);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ version: 1, magneticDeclination: measured });

    const stale = await put(0, { value: 3, source: 'measured' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ currentVersion: 1, conflicts: ['version'] });

    // The same value again writes nothing.
    expect((await put(1, measured)).json().version).toBe(1);
    expect((await put(1, null)).json()).toMatchObject({ version: 2, magneticDeclination: null });

    const entries = await history();
    expect(entries.map((e) => [e.useKind, e.action, e.actor, e.changes[0]?.text])).toEqual([
      ['home', 'update', 'agent', 'magnetic declination 2.5° → from the home model'],
      ['home', 'update', 'agent', 'magnetic declination from the home model → 2.5°'],
    ]);
    expect(entries[0]!.after).toEqual({ params: {}, magneticDeclination: null });
  });

  it('rejects an invalid bearing', async () => {
    expect((await put(0, { value: 400, source: 'measured' })).statusCode).toBe(400);
    expect((await put(0, { value: 1 })).statusCode).toBe(400);
  });

  it('is undone with the uses undo endpoint', async () => {
    await put(0, measured);
    await put(1, { value: 4, source: 'measured' });
    const [latest, first] = await history();
    expect(latest!.canUndo).toBe(true);
    // The first change was changed again later: undo the later one first.
    const blocked = await inject(
      'POST',
      `/api/homes/mock-home/uses/mock-home/history/${first!.id}/undo`,
    );
    expect(blocked.statusCode).toBe(409);

    const undo = await inject(
      'POST',
      `/api/homes/mock-home/uses/mock-home/history/${latest!.id}/undo`,
    );
    expect(undo.statusCode, undo.body).toBe(200);
    expect(undo.json()).toMatchObject({
      entry: { action: 'undo', useKind: 'home', undoesId: latest!.id },
      settings: { version: 3, magneticDeclination: measured },
    });
    expect(
      (await inject('GET', '/api/homes/mock-home')).json().building.magneticDeclination,
    ).toEqual(measured);
    const again = await inject(
      'POST',
      `/api/homes/mock-home/uses/mock-home/history/${latest!.id}/undo`,
    );
    expect(again.statusCode).toBe(409);
  });
});
