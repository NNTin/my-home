import { catalog, effectiveParams, furnitureSize } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import { boundsOf } from '../../piece-page/Inspector';
import { BUDGETS } from '../../quality/perfReport';
import { partBatches } from '../PartsMesh';
import { pieces } from '../registry';
import type { Part } from '../types';

/** The pieces the photo drift audit (#148) called for: the shoe rack, the rug or mat, the dining table. */

function draw(id: string, overrides: Record<string, unknown> = {}) {
  const type = catalog.get(id)!;
  const { values } = effectiveParams(type, overrides);
  const size = furnitureSize(values);
  const ctx = { width: size.width, height: size.height, wallDepth: size.depth };
  return { parts: pieces.get(id)!.parts(values, ctx), size };
}

const top = (p: Part) => boundsOf([p]).max[1];
const bottom = (p: Part) => boundsOf([p]).min[1];

const CASES: [string, Record<string, unknown>, number][] = [
  ['furniture.shoe-rack', {}, 1],
  ['furniture.shoe-rack', { width: 0.4, depth: 0.2, height: 0.2, tiers: 4 }, 1],
  ['furniture.shoe-rack', { width: 1.4, depth: 0.4, height: 0.9, tiers: 1 }, 1],
  ['furniture.rug', {}, 1],
  ['furniture.rug', { width: 4, depth: 3 }, 1],
  ['furniture.rug', { width: 0.4, depth: 0.3 }, 1],
  ['furniture.dining-table', {}, 2],
  ['furniture.dining-table', { width: 0.8, depth: 0.6 }, 2],
  ['furniture.dining-table', { width: 2.4, depth: 1.2, color: '#5b4130' }, 2],
];

describe('the shoe rack, the rug and the dining table', () => {
  it.each(CASES)(
    '%s %j: a finish on every part, %i mesh(es), exactly its footprint and height, a piece’s triangles',
    (id, overrides, meshCount) => {
      const { parts, size } = draw(id, overrides);
      expect(parts.filter((p) => !p.material?.finish)).toEqual([]);
      const meshes = partBatches(parts);
      expect(meshes).toHaveLength(meshCount);
      expect(meshes.reduce((n, m) => n + m.triangles, 0)).toBeLessThanOrEqual(
        BUDGETS.trianglesPerPiece,
      );
      const { min, max } = boundsOf(parts);
      expect(min[1]).toBeCloseTo(0);
      expect(max[1]).toBeCloseTo(size.height);
      expect(min[0]).toBeCloseTo(-size.width / 2);
      expect(max[0]).toBeCloseTo(size.width / 2);
      expect(min[2]).toBeCloseTo(-size.depth / 2);
      expect(max[2]).toBeCloseTo(size.depth / 2);
    },
  );

  it('a shoe rack has two bars a tier, each lying on the rails of both end frames', () => {
    for (const overrides of [
      {},
      { tiers: 4, height: 0.2 },
      { tiers: 1 },
      { tiers: 3, width: 1.4 },
    ]) {
      const { parts, size } = draw('furniture.shoe-rack', overrides);
      const tiers = Number((overrides as { tiers?: number }).tiers ?? 2);
      const bars = parts.filter((p) => p.role === 'detail');
      const rails = parts.filter((p) => p.role === 'frame' && p.size[1] < size.height);
      const posts = parts.filter((p) => p.role === 'frame' && p.size[1] === size.height);
      expect(bars).toHaveLength(2 * tiers);
      expect(rails).toHaveLength(2 * tiers);
      expect(posts).toHaveLength(4);
      for (const bar of bars) {
        const b = boundsOf([bar]);
        // Its ends meet the frames' inner faces, at a rail's height, between the posts.
        expect(b.min[0]).toBeCloseTo(-size.width / 2 + 0.02);
        expect(b.max[0]).toBeCloseTo(size.width / 2 - 0.02);
        expect(rails.some((r) => Math.abs(r.center[1] - bar.center[1]) < 1e-9)).toBe(true);
        expect(Math.abs(bar.center[2]) + bar.size[0] / 2).toBeLessThanOrEqual(
          size.depth / 2 - 0.02 + 1e-9,
        );
      }
      // Every rail runs from the front post to the back one.
      for (const rail of rails) expect(rail.size[2]).toBeCloseTo(size.depth - 0.04);
      // The top tier is at the full height.
      expect(Math.max(...bars.map(top))).toBeLessThanOrEqual(size.height + 1e-9);
      expect(Math.max(...rails.map(top))).toBeCloseTo(size.height);
    }
  });

  it('a rug’s field lies inside its border and stands a little higher, so the tops never meet', () => {
    for (const overrides of [{}, { width: 4, depth: 3 }, { width: 0.4, depth: 0.3 }]) {
      const { parts, size } = draw('furniture.rug', overrides);
      const [border, field] = parts as [Part, Part];
      const [b, f] = [boundsOf([border]), boundsOf([field])];
      expect(f.min[0]).toBeGreaterThan(b.min[0]);
      expect(f.max[2]).toBeLessThan(b.max[2]);
      expect(top(field)).toBeCloseTo(size.height);
      expect(top(border)).toBeLessThan(top(field) - 0.001);
      expect(bottom(border)).toBeCloseTo(0);
      expect(bottom(field)).toBeCloseTo(0);
    }
    expect(catalog.get('furniture.rug')!.footprint).toBe('none');
  });

  it('a dining table’s legs stand on the floor under its top, the frame between them under the top', () => {
    for (const overrides of [{}, { width: 0.8, depth: 0.6 }, { width: 2.4, depth: 1.2 }]) {
      const { parts, size } = draw('furniture.dining-table', overrides);
      const board = parts.find((p) => p.role === 'board')!;
      const underside = bottom(board);
      const legs = parts.filter((p) => p.role === 'post');
      const frame = parts.filter((p) => p.role === 'body');
      expect(legs).toHaveLength(4);
      expect(frame).toHaveLength(4);
      for (const leg of legs) {
        expect(bottom(leg)).toBeCloseTo(0);
        expect(top(leg)).toBeCloseTo(underside);
      }
      for (const rail of frame) {
        expect(top(rail)).toBeCloseTo(underside);
        const r = boundsOf([rail]);
        // Each rail ends on two legs' faces.
        const touching = legs.filter((leg) => {
          const l = boundsOf([leg]);
          return (
            r.min[0] <= l.max[0] + 1e-9 &&
            r.max[0] >= l.min[0] - 1e-9 &&
            r.min[2] <= l.max[2] + 1e-9 &&
            r.max[2] >= l.min[2] - 1e-9
          );
        });
        expect(touching).toHaveLength(2);
      }
      expect(top(board)).toBeCloseTo(size.height);
    }
  });
});
