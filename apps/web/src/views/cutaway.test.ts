import { HomeModel } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import realHomeJson from '../../../../data/homes/home.json';
import mockHomeJson from '../../../../packages/shared/test-fixtures/mock-home.json';
import { buildHome } from '../builder/buildHome';
import { shellItems, type DrawItem } from '../builder/drawList';
import { batches, shapeGeometry } from '../scene/batches';

/**
 * The cut caps of a cutaway (docs/design/realistic-render.md §7.2) and the neutral shells of the
 * levels that are not modelled inside (§7.5).
 */

const home = buildHome(HomeModel.parse(structuredClone(realHomeJson)));
const mock = buildHome(HomeModel.parse(structuredClone(mockHomeJson)));

const triangles = (item: DrawItem) => {
  const g = shapeGeometry(item.shape);
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
};

describe('the tops of cut walls', () => {
  it.each([
    ['home', home],
    ['mock-home', mock],
  ])('in %s the top of every wall is a cut face, and a sill is not', (_name, scene) => {
    const items = new Map(shellItems(scene).map((i) => [i.id, i]));
    expect(scene.walls.some((w) => !w.cutTop)).toBe(true);
    for (const w of scene.walls) {
      // Below a window the segment ends at the sill: the wall goes on above the opening.
      expect(w.cutTop, w.id).toBe(!w.id.endsWith(':below'));
      const top = items.get(`${w.id}/top`);
      const rest = items.get(w.id)!;
      if (!w.cutTop) {
        expect(top).toBeUndefined();
        expect(rest.shape).toMatchObject({ only: 'core' });
        continue;
      }
      expect(top, w.id).toMatchObject({ finish: 'cut.dark', closed: true, group: rest.group });
      expect(top!.shape).toMatchObject({ only: 'top' });
      expect(rest.shape).toMatchObject({ only: 'rest' });
      expect(rest.finish).not.toBe('cut.dark');
    }
  });

  it('the top and the rest are the core: no triangle is lost or drawn twice', () => {
    for (const w of home.walls.filter((x) => x.cutTop)) {
      const items = shellItems({ ...home, walls: [w] }).filter((i) => i.id.startsWith(w.id));
      const core = items.find((i) => i.id === w.id)!;
      const top = items.find((i) => i.id === `${w.id}/top`)!;
      const whole = { ...core, shape: { ...core.shape, only: 'core' } } as DrawItem;
      expect(triangles(top), w.id).toBeGreaterThan(0);
      expect(triangles(top) + triangles(core), w.id).toBe(triangles(whole));
      // Every vertex of the top looks up.
      const normal = shapeGeometry(top.shape).getAttribute('normal');
      for (let i = 0; i < normal.count; i++) expect(normal.getY(i)).toBeGreaterThan(0.5);
    }
  });

  it('costs one more mesh per level and apartment, not one per wall', () => {
    const caps = batches(shellItems(home)).filter((b) => b.finish === 'cut.dark');
    expect(caps.length).toBeGreaterThan(0);
    expect(caps.length).toBeLessThanOrEqual(home.levels.length * (home.apartments.length + 1));
    expect(caps.reduce((n, b) => n + b.items, 0)).toBe(home.walls.filter((w) => w.cutTop).length);
  });
});

describe('the levels above the one modelled inside', () => {
  it('are neutral shells: every inner surface draws shell.neutral', () => {
    const upper = new Set(home.levels.filter((l) => l.index > 0).map((l) => l.id));
    expect(upper.size).toBe(2);
    for (const f of [...home.roomFloors, ...home.roomCeilings, ...home.ceilings])
      if (upper.has(f.levelId)) expect(f.finish.finish, f.id).toBe('shell.neutral');
    for (const w of home.walls.filter((x) => upper.has(x.levelId))) {
      // A face that borders a room, and everything of an inner wall.
      for (const face of w.faces)
        if (face.roomId !== undefined || w.kind === 'interior')
          expect(face.finish.finish, w.id).toBe('shell.neutral');
      if (w.kind === 'interior') expect(w.finish.finish, w.id).toBe('shell.neutral');
    }
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
