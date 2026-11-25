import { catalog, effectiveParams, furnitureSize } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import { partShape } from '../../builder/drawList';
import { boundsOf } from '../../piece-page/Inspector';
import { BUDGETS } from '../../quality/perfReport';
import { partBatches } from '../PartsMesh';
import { pieces } from '../registry';

/**
 * Seating and tables as rebuilt for docs/design/realistic-render.md step 6b: sofa, chair, table,
 * desk, bed.
 */

function draw(id: string, overrides: Record<string, unknown> = {}) {
  const type = catalog.get(id)!;
  const { values } = effectiveParams(type, overrides);
  const size = furnitureSize(values);
  const ctx = { width: size.width, height: size.height, wallDepth: size.depth };
  return { parts: pieces.get(id)!.parts(values, ctx), size };
}

const CASES: [string, Record<string, unknown>, number][] = [
  ['furniture.sofa', {}, 2],
  ['furniture.sofa', { width: 3.2 }, 2],
  ['furniture.sofa', { width: 1.2 }, 2],
  ['furniture.chair', {}, 1],
  ['furniture.table', {}, 1],
  ['furniture.table', { diameter: 1.6, color: '#6b4a2b' }, 2],
  ['furniture.desk', {}, 2],
  ['furniture.desk', { width: 0.8 }, 1],
  ['furniture.desk', { width: 2.2, depth: 0.9, color: '#6b4a2b' }, 2],
  ['furniture.bed', {}, 2],
  ['furniture.bed', { width: 2.2, length: 2.2 }, 2],
];

describe('seating and tables', () => {
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
      expect(min[1]).toBeCloseTo(0);
      expect(min[0]).toBeGreaterThanOrEqual(-size.width / 2 - 1e-6);
      expect(max[0]).toBeLessThanOrEqual(size.width / 2 + 1e-6);
      expect(min[2]).toBeGreaterThanOrEqual(-size.depth / 2 - 1e-6);
      // A desk drawer's handle stands off its front, inside the top's overhang.
      expect(max[2]).toBeLessThanOrEqual(size.depth / 2 + 1e-6);
    },
  );

  it('nothing floats: rails under the chair\u2019s seat, the desk\u2019s panel under its top, the bed\u2019s mattress on its slats', () => {
    const chair = draw('furniture.chair').parts;
    const seat = boundsOf([
      chair.find((p) => p.shape === 'extrude' && p.rotationX === Math.PI / 2)!,
    ]);
    const rails = chair.filter((p) => p.shape === 'box' && p.size[1] === 0.05 && !p.rotationX);
    expect(rails).toHaveLength(3);
    for (const rail of rails) expect(rail.center[1] + rail.size[1] / 2).toBeCloseTo(seat.min[1]);
    const desk = draw('furniture.desk').parts;
    const top = boundsOf([desk[0]!]);
    for (const part of desk.slice(1, 5))
      expect(part.center[1] + part.size[1] / 2).toBeCloseTo(top.min[1]);
    const bed = draw('furniture.bed').parts;
    const mattress = bed.find((p) => p.shape === 'roundedBox')!;
    const slats = bed.find((p) => p.size[1] === 0.03)!;
    expect(slats.center[1] + slats.size[1] / 2).toBeCloseTo(
      mattress.center[1] - mattress.size[1] / 2,
    );
    // A sofa's cushions sink into its base; a table's top lies on its pedestal.
    const table = draw('furniture.table').parts;
    expect(table[1]!.center[1] + table[1]!.size[1] / 2).toBeCloseTo(
      table[0]!.center[1] - table[0]!.size[1] / 2,
    );
  });

  it('a sofa has a seat and a back cushion for each 70 cm between its arms', () => {
    for (const [width, seats] of [
      [1.2, 1],
      [2, 2],
      [3.2, 4],
    ] as const) {
      const { parts, size } = draw('furniture.sofa', { width });
      const soft = parts.filter((p) => p.shape === 'roundedBox');
      // The back, two arms, and a seat and a back cushion a seat.
      expect(soft).toHaveLength(3 + 2 * seats);
      expect(soft.every((p) => p.material?.finish === 'fabric.weave')).toBe(true);
      expect(parts.filter((p) => p.role === 'detail')).toHaveLength(4);
      expect(boundsOf(parts).max[1]).toBeCloseTo(size.height);
    }
  });

  it('a chair’s back legs run on as the posts of its back, which leans', () => {
    const { parts, size } = draw('furniture.chair');
    const posts = parts.filter((p) => p.shape === 'extrude' && p.rotationY !== 0);
    expect(posts).toHaveLength(2);
    for (const post of posts) {
      const { min, max } = boundsOf([post]);
      expect(min[1]).toBeCloseTo(0);
      expect(max[1]).toBeCloseTo(size.height, 2);
      expect(max[1]).toBeLessThanOrEqual(size.height);
      expect(min[2]).toBeCloseTo(-size.depth / 2, 2);
    }
    // The seat is at 46 cm, with rounded corners.
    const seat = parts.find((p) => p.shape === 'extrude' && p.rotationX === Math.PI / 2)!;
    expect(seat.center[1] + seat.size[2] / 2).toBeCloseTo(0.46);
    expect(parts.filter((p) => p.rotationX !== undefined && p.shape === 'box')).toHaveLength(2);
  });

  it('a table’s top is veneer where its colour can be, on a turned pedestal that is a solid', () => {
    const { parts, size } = draw('furniture.table', { color: '#6b4a2b' });
    const [top, pedestal] = parts;
    expect(top!.material).toEqual({ finish: 'wood.veneer' });
    expect(top!.center[1] + top!.size[1] / 2).toBeCloseTo(size.height);
    expect(top!.size[0]).toBeCloseTo(size.width);
    expect(pedestal!.shape).toBe('lathe');
    expect(partShape(pedestal!).closed).toBe(true);
    expect(pedestal!.center[1] + pedestal!.size[1] / 2).toBeCloseTo(size.height - 0.04);
    expect(pedestal!.material).toEqual({ finish: 'plastic.matt' });
  });

  it('a desk has a pedestal of three drawers where it leaves 75 cm of knee room', () => {
    const wide = draw('furniture.desk').parts;
    expect(wide.filter((p) => p.role === 'leaf')).toHaveLength(3);
    expect(wide.filter((p) => p.role === 'handle')).toHaveLength(3);
    const narrow = draw('furniture.desk', { width: 1.1 }).parts;
    expect(narrow.filter((p) => p.role === 'leaf')).toHaveLength(0);
    // The top's grain runs along it.
    expect(wide[0]!.rotationY).toBe(Math.PI / 2);
  });

  it('a bed’s mattress ends at its height, under two pillows and a duvet; the headboard is 1.8 times as high', () => {
    const { parts, size } = draw('furniture.bed');
    const soft = parts.filter((p) => p.shape === 'roundedBox');
    expect(soft).toHaveLength(4);
    const [mattress, , , duvet] = soft;
    expect(mattress!.center[1] + mattress!.size[1] / 2).toBeCloseTo(size.height);
    expect(duvet!.center[1] + duvet!.size[1] / 2).toBeGreaterThan(size.height);
    expect(boundsOf(parts).max[1]).toBeCloseTo(size.height * 1.8);
    expect(parts[0]!.material).toEqual({ finish: 'wood.veneer' });
  });
});
