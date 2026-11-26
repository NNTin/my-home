import { catalog, effectiveParams, furnitureSize } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import { boundsOf } from '../../piece-page/Inspector';
import { BUDGETS } from '../../quality/perfReport';
import { partBatches } from '../PartsMesh';
import { pieces } from '../registry';

/**
 * The bath room's pieces (#146): the corner bathtub, the walk-in shower, the wall-hung toilet, the
 * washbasin cabinet, the tiled ledge, and the washing machine with a dryer on it.
 */

function draw(id: string, overrides: Record<string, unknown> = {}) {
  const type = catalog.get(id)!;
  const { values } = effectiveParams(type, overrides);
  const size = furnitureSize(values);
  const ctx = { width: size.width, height: size.height, wallDepth: size.depth };
  const piece = pieces.get(id)!;
  return { parts: piece.parts(values, ctx), size, values, ctx, piece };
}

/** Every type at its defaults and at the limits a use may choose, with its number of meshes. */
const CASES: [string, Record<string, unknown>, number][] = [
  ['bath.corner-tub', {}, 2],
  ['bath.corner-tub', { width: 1.2, depth: 1.7, height: 0.45, corner: 'right' }, 2],
  ['bath.corner-tub', { width: 1.7, depth: 1.2, height: 0.7 }, 2],
  ['bath.shower', {}, 2],
  ['bath.shower', { width: 0.7, depth: 1.8, height: 1.8, corner: 'right' }, 2],
  ['bath.shower', { width: 1.8, depth: 0.7, height: 2.2 }, 2],
  ['bath.toilet', {}, 2],
  ['bath.toilet', { depth: 0.48 }, 2],
  ['bath.toilet', { depth: 0.6 }, 2],
  ['bath.vanity', {}, 2],
  ['bath.vanity', { width: 0.4, depth: 0.35, height: 0.35, drawers: 3 }, 2],
  ['bath.vanity', { width: 1.4, depth: 0.55, height: 0.7, drawers: 1 }, 2],
  ['bath.ledge', {}, 1],
  ['bath.ledge', { width: 0.3, depth: 0.08, height: 0.2 }, 1],
  ['bath.ledge', { width: 4, depth: 0.6, height: 2.3 }, 1],
  ['appliance.washing-machine', {}, 2],
  ['appliance.washing-machine', { width: 0.55, height: 0.8, depth: 0.45 }, 2],
  ['appliance.washing-machine', { width: 0.7, height: 1.8, depth: 0.7 }, 2],
];

describe('the bath room pieces', () => {
  it.each(CASES)(
    '%s %j names a finish on every part and is %i mesh(es), within a piece’s triangles',
    (id, overrides, meshCount) => {
      const { parts } = draw(id, overrides);
      expect(parts.filter((p) => !p.material?.finish)).toEqual([]);
      const meshes = partBatches(parts);
      expect(meshes).toHaveLength(meshCount);
      expect(meshes.reduce((n, m) => n + m.triangles, 0)).toBeLessThanOrEqual(
        BUDGETS.trianglesPerPiece,
      );
      for (const part of parts)
        for (const n of [...part.center, ...part.size]) {
          expect(Number.isFinite(n)).toBe(true);
        }
      for (const part of parts) for (const n of part.size) expect(n).toBeGreaterThan(0);
    },
  );

  it.each(CASES)('%s %j stays inside its footprint, on its bottom', (id, overrides) => {
    const { parts, size } = draw(id, overrides);
    const { min, max } = boundsOf(parts);
    expect(min[1]).toBeGreaterThanOrEqual(-1e-6);
    // A handle stands off its front: the shower door's, at the side, by 5.2 cm.
    const off = id === 'bath.shower' ? 0.052 : 0;
    expect(min[0]).toBeGreaterThanOrEqual(-size.width / 2 - off - 1e-6);
    expect(max[0]).toBeLessThanOrEqual(size.width / 2 + off + 1e-6);
    expect(min[2]).toBeGreaterThanOrEqual(-size.depth / 2 - 1e-6);
    expect(max[2]).toBeLessThanOrEqual(size.depth / 2 + 0.015 + 1e-6);
  });

  it.each(['bath.corner-tub', 'bath.ledge', 'appliance.washing-machine'])(
    '%s is as high as its height says, and reaches its footprint’s back',
    (id) => {
      const { parts, size } = draw(id);
      const { min, max } = boundsOf(parts);
      expect(max[1]).toBeCloseTo(size.height, 2);
      expect(min[2]).toBeCloseTo(-size.depth / 2, 2);
    },
  );

  it('the tub fills its corner: the rim along both walls, the front a quarter round, the apron under the lip', () => {
    for (const corner of ['left', 'right'] as const) {
      const { parts, size } = draw('bath.corner-tub', { corner });
      const wall = corner === 'left' ? -1 : 1;
      const [floor, walls, front, apron] = parts.map((p) => boundsOf([p]));
      // The rim reaches the corner; the front and the apron reach the open ends of both walls.
      expect(walls!.min[2]).toBeCloseTo(-size.depth / 2);
      expect(wall * (wall < 0 ? walls!.min[0] : walls!.max[0])).toBeCloseTo(size.width / 2);
      // The apron is the footprint's front; the rim stands behind it, its thickness inside.
      for (const [round, inside] of [
        [front!, 0.02],
        [apron!, 0],
      ] as const) {
        expect(round.max[2]).toBeCloseTo(size.depth / 2 - inside, 2);
        expect(-wall * (wall < 0 ? round.max[0] : round.min[0])).toBeCloseTo(
          size.width / 2 - inside,
          2,
        );
        expect(round.min[2]).toBeCloseTo(-size.depth / 2, 2);
      }
      // Nothing floats: the rim and the apron stand on the floor, the bowl's floor is inside.
      for (const part of [walls!, front!, apron!]) expect(part.min[1]).toBeCloseTo(0);
      expect(apron!.max[1]).toBeCloseTo(size.height - 0.03);
      expect(walls!.max[1]).toBeCloseTo(size.height);
      expect(floor!.max[1]).toBeCloseTo(size.height - 0.42);
      // The far corner of the footprint is free: the front is round.
      const far = parts.flatMap((p) => {
        const b = boundsOf([p]);
        return -wall * (wall < 0 ? b.max[0] : b.min[0]) > size.width / 2 - 0.05 &&
          b.max[2] > size.depth / 2 - 0.05
          ? [p]
          : [];
      });
      expect(far.every((p) => p.shape === 'extrude')).toBe(true);
    }
  });

  it('the shower’s glass is on the front and on the side away from the wall, between profiles', () => {
    for (const corner of ['left', 'right'] as const) {
      const { parts, size } = draw('bath.shower', { corner });
      const open = corner === 'left' ? 1 : -1;
      const panes = parts.filter((p) => p.role === 'glass');
      expect(panes).toHaveLength(2);
      expect(panes.every((p) => p.material?.transparent)).toBe(true);
      // Drawn last, over what stands behind them.
      expect(parts.slice(-2)).toEqual(panes);
      const [front, side] = panes;
      expect(front!.center[2]).toBeCloseTo(size.depth / 2 - 0.015);
      expect(open * side!.center[0]).toBeCloseTo(size.width / 2 - 0.015);
      const posts = parts.filter((p) => p.role === 'frame' && p.size[1] === size.height);
      expect(posts).toHaveLength(3);
      // Each pane ends at a post on both ends.
      expect(front!.size[0]).toBeCloseTo(size.width - 0.06);
      expect(side!.size[2]).toBeCloseTo(size.depth - 0.06);
      // The handle is outside the side pane and touches it.
      const handle = boundsOf(parts.filter((p) => p.role === 'frame' && p.size[2] === 0.014));
      expect(open > 0 ? handle.min[0] : -handle.max[0]).toBeCloseTo(size.width / 2 - 0.011);
      expect(Math.abs(open > 0 ? handle.max[0] : handle.min[0])).toBeCloseTo(
        size.width / 2 + 0.037,
      );
    }
  });

  it('the shower’s rail, arm and head hang together at the back wall', () => {
    const { parts, size } = draw('bath.shower');
    const [rail, , arm, head] = parts.slice(1, 5).map((p) => boundsOf([p]));
    expect(rail!.min[2]).toBeGreaterThanOrEqual(-size.depth / 2);
    expect(arm!.min[2]).toBeLessThanOrEqual(rail!.max[2]);
    expect(arm!.max[1]).toBeCloseTo(rail!.max[1]);
    expect(head!.max[1]).toBeGreaterThanOrEqual(arm!.min[1] - 1e-6);
    expect(head!.min[2]).toBeLessThanOrEqual(arm!.max[2]);
  });

  it('the toilet’s seat lies on its bowl and its flush plate is on the wall above', () => {
    for (const depth of [0.48, 0.54, 0.6]) {
      const { parts, size } = draw('bath.toilet', { depth });
      const [bowl, seat, plate] = parts.map((p) => boundsOf([p]));
      expect(seat!.min[1]).toBeCloseTo(bowl!.max[1]);
      expect(seat!.max[1]).toBeCloseTo(size.height);
      expect(bowl!.min[2]).toBeCloseTo(-depth / 2);
      expect(seat!.max[2]).toBeCloseTo(depth / 2, 2);
      expect(plate!.min[2]).toBeCloseTo(-depth / 2);
      expect(plate!.min[1]).toBeGreaterThan(size.height + 0.4);
    }
  });

  it('the vanity’s drawers fill its body under the basin, each with a handle on its front', () => {
    for (const drawers of [1, 2, 3]) {
      const { parts, size } = draw('bath.vanity', { drawers });
      const fronts = parts.filter((p) => p.role === 'leaf');
      expect(fronts).toHaveLength(drawers);
      expect(parts.filter((p) => p.role === 'handle')).toHaveLength(drawers);
      const basin = boundsOf([parts.find((p) => p.material?.finish === 'ceramic.white')!]);
      expect(basin.max[1]).toBeCloseTo(size.height);
      expect(boundsOf(fronts).max[1]).toBeCloseTo(basin.min[1] - 0.0015);
      expect(boundsOf([parts[0]!]).max[1]).toBeCloseTo(basin.min[1]);
      // The fronts stand back under the basin's edge, and the handles stay under it too.
      expect(boundsOf(fronts).max[2]).toBeCloseTo(size.depth / 2 - 0.02);
      for (const handle of parts.filter((p) => p.role === 'handle')) {
        const bar = boundsOf([handle]);
        expect(bar.min[2]).toBeCloseTo(size.depth / 2 - 0.02);
        expect(bar.max[1]).toBeLessThan(basin.min[1]);
      }
    }
  });

  it('a washing machine is one machine up to 1.2 m and a column of two above', () => {
    for (const [height, machines] of [
      [0.85, 1],
      [1.19, 1],
      [1.2, 2],
      [1.7, 2],
    ] as const) {
      const { parts, size } = draw('appliance.washing-machine', { height });
      const bodies = parts.filter((p) => p.shape === 'roundedBox');
      expect(bodies).toHaveLength(machines);
      expect(parts.filter((p) => p.role === 'leaf')).toHaveLength(machines);
      expect(boundsOf(bodies).max[1]).toBeCloseTo(size.height);
      // Each body stands on its feet, and the feet on the floor or on the machine below.
      const feet = parts.filter((p) => p.size[1] === 0.01);
      bodies.forEach((body, i) => {
        const foot = boundsOf([feet[i]!]);
        expect(foot.max[1]).toBeCloseTo(boundsOf([body]).min[1]);
        expect(foot.min[1]).toBeCloseTo((i * height) / machines);
      });
      // The door is inside its machine's front, under the control panel.
      for (const door of parts.filter((p) => p.role === 'leaf')) {
        const ring = boundsOf([door]);
        expect(ring.max[0] - ring.min[0]).toBeLessThanOrEqual(size.width - 0.12 + 1e-6);
        expect(ring.max[2]).toBeLessThanOrEqual(size.depth / 2 + 1e-6);
      }
    }
  });
});
