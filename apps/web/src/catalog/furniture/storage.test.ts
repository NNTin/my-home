import { catalog, effectiveParams, furnitureSize } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import { boundsOf } from '../../piece-page/Inspector';
import { BUDGETS } from '../../quality/perfReport';
import { partBatches } from '../PartsMesh';
import { pieces } from '../registry';

/**
 * The storage pieces as rebuilt for docs/design/realistic-render.md step 6b: storage shelf, shoe
 * cabinet, wardrobe.
 */

function draw(id: string, overrides: Record<string, unknown> = {}) {
  const type = catalog.get(id)!;
  const { values } = effectiveParams(type, overrides);
  const size = furnitureSize(values);
  const ctx = { width: size.width, height: size.height, wallDepth: size.depth };
  return { parts: pieces.get(id)!.parts(values, ctx), size };
}

const CASES: [string, Record<string, unknown>, number][] = [
  ['furniture.storage-shelf', {}, 1],
  ['furniture.storage-shelf', { width: 1.5, height: 1.5, columns: 4, rows: 5 }, 1],
  ['furniture.storage-shelf', { color: '#6b4a2b' }, 2],
  ['furniture.shoe-cabinet', {}, 1],
  ['furniture.shoe-cabinet', { width: 1.2, doors: 3, height: 1.4 }, 1],
  ['furniture.wardrobe', {}, 2],
  ['furniture.wardrobe', { width: 3, height: 2.6 }, 2],
  ['furniture.wardrobe', { color: '#5b4130' }, 3],
];

describe('the storage pieces', () => {
  it.each(CASES)(
    '%s %j: a finish on every part, %i mesh(es), in its footprint and a piece’s triangles',
    (id, overrides, meshCount) => {
      const { parts, size } = draw(id, overrides);
      expect(parts.filter((p) => !p.material?.finish)).toEqual([]);
      const meshes = partBatches(parts);
      expect(meshes).toHaveLength(meshCount);
      expect(meshes.reduce((n, m) => n + m.triangles, 0)).toBeLessThanOrEqual(
        BUDGETS.trianglesPerPiece,
      );
      const { min, max } = boundsOf(parts);
      expect(min[1]).toBeGreaterThanOrEqual(-1e-9);
      expect(max[1]).toBeCloseTo(size.height);
      expect(min[0]).toBeCloseTo(-size.width / 2);
      expect(max[0]).toBeCloseTo(size.width / 2);
      expect(min[2]).toBeCloseTo(-size.depth / 2);
      // Knobs and handles stand off the front.
      expect(max[2]).toBeLessThanOrEqual(size.depth / 2 + 0.03 + 1e-9);
    },
  );

  it('a bin hangs by its rim on two runners and is narrower below it', () => {
    const { parts } = draw('furniture.storage-shelf');
    const bins = parts.filter((p) => p.role === 'body' && p.color === '#f3f3f0');
    // Nine bins: a rim and a body each.
    expect(bins).toHaveLength(18);
    const [rim, body] = bins;
    expect(rim!.size[0]).toBeGreaterThan(body!.size[0]);
    expect(rim!.center[1]).toBeGreaterThan(body!.center[1] + body!.size[1] / 2);
    const runners = parts.filter((p) => p.size[0] === 0.012 && p.size[1] === 0.012);
    expect(runners).toHaveLength(18);
    // The rim lies on its runners: its ends over them, its underside on their tops.
    const [left, right] = runners;
    expect(rim!.center[0] - rim!.size[0] / 2).toBeLessThan(left!.center[0] + 0.006);
    expect(rim!.center[0] + rim!.size[0] / 2).toBeGreaterThan(right!.center[0] - 0.006);
    expect(rim!.center[1] - rim!.size[1] / 2).toBeCloseTo(left!.center[1] + 0.006);
    expect(parts.filter((p) => p.role === 'detail')).toHaveLength(9);
  });

  it('a pine frame is lacquer in its colour, a darker one stained oak veneer', () => {
    const pine = draw('furniture.storage-shelf').parts[0]!;
    expect(pine.material).toEqual({ finish: 'plastic.matt' });
    expect(pine.color).toBe('#d6b98c');
    const walnut = draw('furniture.storage-shelf', { color: '#6b4a2b' }).parts[0]!;
    expect(walnut.material).toEqual({ finish: 'wood.veneer' });
  });

  it('the shoe cabinet has a round knob on each door', () => {
    for (const doors of [1, 2, 3]) {
      const { parts } = draw('furniture.shoe-cabinet', { doors, width: 1.2 });
      const knobs = parts.filter((p) => p.role === 'handle');
      expect(knobs).toHaveLength(doors);
      expect(knobs.every((p) => p.shape === 'cylinder')).toBe(true);
      expect(parts.filter((p) => p.role === 'leaf')).toHaveLength(doors);
    }
  });

  it('the wardrobe has a pair of doors for each 1.2 m, their handles where each pair meets', () => {
    for (const [width, pairs] of [
      [0.5, 1],
      [1.2, 1],
      [2.4, 2],
      [3, 3],
    ] as const) {
      const { parts } = draw('furniture.wardrobe', { width });
      const leaves = parts.filter((p) => p.role === 'leaf');
      const handles = parts.filter((p) => p.role === 'handle');
      expect(leaves).toHaveLength(2 * pairs);
      expect(handles).toHaveLength(2 * pairs);
      const door = width / (2 * pairs);
      handles.forEach((h, i) => {
        const meeting = -width / 2 + door * (i + (i % 2 ? 0 : 1));
        expect(Math.abs(h.center[0] - meeting)).toBeCloseTo(0.04);
      });
    }
  });

  it('the wardrobe stands on a plinth that is set back, under a top over its whole footprint', () => {
    const { parts, size } = draw('furniture.wardrobe');
    const [plinth, , top] = parts;
    expect(plinth!.center[1] + plinth!.size[1] / 2).toBeCloseTo(0.06);
    expect(plinth!.center[2] + plinth!.size[2] / 2).toBeLessThan(size.depth / 2 - 0.02);
    expect(top!.size).toEqual([size.width, 0.018, size.depth]);
  });
});
