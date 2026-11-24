import { HomeModel } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import realHomeJson from '../../../../data/homes/home.json';
import mockHomeJson from '../../../../packages/shared/test-fixtures/mock-home.json';
import { buildHome } from '../builder/buildHome';
import { shellItems } from '../builder/drawList';
import { batches, shapeGeometry } from '../scene/batches';

/**
 * The cut caps of a cutaway (docs/design/realistic-render.md §7.2) and the neutral shells of the
 * levels that are not modelled inside (§7.5).
 */

const home = buildHome(HomeModel.parse(structuredClone(realHomeJson)));
const mock = buildHome(HomeModel.parse(structuredClone(mockHomeJson)));

describe('the tops of cut walls', () => {
  it.each([
    ['home', home],
    ['mock-home', mock],
  ])('in %s the top of every wall is a cut face, and a sill is not', (_name, scene) => {
    const items = new Map(shellItems(scene).map((i) => [i.id, i]));
    const tops = scene.wallFaces.filter((f) => f.part === 'top');
    expect(tops.length).toBeGreaterThan(0);
    for (const f of tops) {
      const top = items.get(f.id)!;
      expect(top, f.id).toMatchObject({ finish: 'cut.dark', closed: false });
      expect(top.group, f.id).toMatchObject({ kind: 'cut', levelId: f.levelId });
      // Every vertex of the top looks up.
      const normal = shapeGeometry(top.shape).getAttribute('normal');
      for (let i = 0; i < normal.count; i++) expect(normal.getY(i)).toBeGreaterThan(0.5);
    }
    // Nothing else of a wall is dark: the sill of a window is the reveal's.
    for (const f of scene.wallFaces.filter((x) => x.part !== 'top'))
      expect(f.finish.finish, f.id).not.toBe('cut.dark');
    expect(scene.wallFaces.some((f) => f.id.includes(':sill-'))).toBe(true);
  });

  it('costs one more mesh per level and apartment, not one per wall', () => {
    const caps = batches(shellItems(home)).filter((b) => b.finish === 'cut.dark');
    expect(caps.length).toBeGreaterThan(0);
    expect(caps.length).toBeLessThanOrEqual(home.levels.length * (home.apartments.length + 1));
    expect(caps.reduce((n, b) => n + b.items, 0)).toBe(
      home.wallFaces.filter((f) => f.part === 'top').length,
    );
  });
});

describe('the levels above the one modelled inside', () => {
  it('are neutral shells: every inner surface draws shell.neutral', () => {
    const upper = new Set(home.levels.filter((l) => l.index > 0).map((l) => l.id));
    expect(upper.size).toBe(2);
    for (const f of [...home.roomFloors, ...home.roomCeilings, ...home.ceilings])
      if (upper.has(f.levelId)) expect(f.finish.finish, f.id).toBe('shell.neutral');
    // Every face of a wall that borders a room.
    const inner = home.wallFaces.filter((f) => upper.has(f.levelId) && f.roomId !== undefined);
    expect(inner.length).toBeGreaterThan(10);
    for (const face of inner) expect(face.finish.finish, face.id).toBe('shell.neutral');
  });

  it('take no finishes in the model: the schema rejects them', () => {
    const json = structuredClone(realHomeJson) as { rooms: Record<string, unknown>[] };
    const room = json.rooms.find((r) => r.id === 'ground-floor-interior')!;
    room.finishes = { floor: { finish: 'wood.oak-laminate', source: 'mock' } };
    const result = HomeModel.safeParse(json);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('not modelled inside');
  });
});
