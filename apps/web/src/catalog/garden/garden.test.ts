import { catalog, effectiveParams, furnitureSize } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import { partShape } from '../../builder/drawList';
import { boundsOf } from '../../piece-page/Inspector';
import { BUDGETS } from '../../quality/perfReport';
import { partBatches } from '../PartsMesh';
import { pieces } from '../registry';
import type { Part } from '../types';

const draw = (id: string, overrides: Record<string, unknown> = {}) => {
  const type = catalog.get(id)!;
  const { values } = effectiveParams(type, overrides);
  return pieces.get(id)!.parts(values, { width: 1, height: 1, wallDepth: 1 });
};

describe('garden pieces', () => {
  it('a shrub with roses carries flowers on its surface', () => {
    const plain = draw('garden.shrub');
    const roses = draw('garden.shrub', { flowers: 'roses' });
    const flowers = roses.filter((p) => p.role === 'detail');
    expect(flowers).toHaveLength(14);
    expect(plain.filter((p) => p.role === 'detail')).toHaveLength(0);
    expect(flowers.every((p) => p.color === '#c23b4e')).toBe(true);
    // Out on the bush, not hidden in it: at least as far out as the slice they sit on.
    for (const f of flowers) expect(Math.hypot(f.center[0], f.center[2])).toBeGreaterThan(0.1);
  });

  it('a pergola has its posts at the front and a roof falling to them', () => {
    const parts = draw('garden.pergola', { posts: 3 });
    const posts = parts.filter((p) => p.role === 'post');
    expect(posts).toHaveLength(3);
    expect(posts.every((p) => p.center[2] > 1.2)).toBe(true);
    const roof = parts.find((p) => p.role === 'panel')!;
    expect(roof.rotationX).toBeCloseTo(Math.atan2(2.45 - 2.15, 2.6));
    expect(roof.material).toMatchObject({ transparent: true });
  });

  it('a log lies on its side along its length', () => {
    const [trunk] = draw('garden.log');
    expect(trunk).toMatchObject({ shape: 'cylinder', rotationY: Math.PI / 2 });
    expect(trunk!.rotationX).toBeCloseTo(Math.PI / 2);
    expect(trunk!.center[1]).toBeCloseTo(0.35 / 2);
  });

  it('a wheelie bin narrows to its foot, its wheels and handle at the back', () => {
    const parts = draw('garden.bin');
    const body = parts.find((p) => p.shape === 'extrude');
    const profile = body?.shape === 'extrude' ? body.profile : [];
    const foot = profile.filter(([, y]) => y < 0);
    const top = profile.filter(([, y]) => y > 0);
    const span = (points: [number, number][]) =>
      Math.max(...points.map(([x]) => x)) - Math.min(...points.map(([x]) => x));
    expect(span(foot)).toBeLessThan(span(top));
    const wheels = parts.filter((p) => p.size[0] === 0.2);
    expect(wheels).toHaveLength(2);
    for (const p of [...wheels, parts.find((p) => p.role === 'handle')!])
      expect(p.center[2]).toBeLessThan(-0.25);
    const { max } = boundsOf(parts);
    expect(max[1]).toBeCloseTo(1.07);
  });

  it('a brick pillar is its width square under a cap that overhangs it', () => {
    const [shaft, cap] = draw('garden.pillar', { diameter: 0.49, height: 1.2 });
    expect(shaft!.size[0]).toBe(0.49);
    expect(shaft!.size[1]).toBeCloseTo(1.12);
    expect(cap!.size[0]).toBeCloseTo(0.55);
    expect(cap!.center[1] + cap!.size[1] / 2).toBeCloseTo(1.2);
  });

  it('a kerb runs along its length, its top edges bevelled', () => {
    const [kerb] = draw('garden.kerb', { width: 6, depth: 0.15, height: 0.25 });
    const { min, max } = boundsOf([kerb!]);
    expect(max[0] - min[0]).toBeCloseTo(6);
    expect(max[2] - min[2]).toBeCloseTo(0.15);
    expect(max[1]).toBeCloseTo(0.25);
    expect(kerb!.shape === 'extrude' && kerb!.profile).toHaveLength(6);
  });

  it('draws a dry-stone pile the same every time, within its size', () => {
    const a = draw('garden.rock-pile');
    expect(draw('garden.rock-pile')).toEqual(a);
    const { min, max } = boundsOf(a);
    expect(min[0]).toBeGreaterThan(-0.95);
    expect(max[0]).toBeLessThan(0.95);
    expect(min[1]).toBeCloseTo(0);
    expect(max[1]).toBeLessThan(0.6 * 1.2);
  });
});

/** The garden pieces as rebuilt for docs/design/realistic-render.md step 6b. */
describe('the rebuilt garden pieces', () => {
  const trianglesOf = (parts: Part[]) => partBatches(parts).reduce((n, m) => n + m.triangles, 0);

  it.each([
    ['garden.chair', {}, 2],
    ['garden.chair', { width: 0.7, depth: 0.75, height: 1.2 }, 2],
    ['garden.table', {}, 2],
    ['garden.table', { width: 2.4, depth: 1.2 }, 2],
    ['garden.bench', {}, 1],
    ['garden.bench', { width: 2.4, color: '#6b4a2b' }, 1],
    ['garden.pergola', {}, 2],
    ['garden.pergola', { width: 6, depth: 4, posts: 4, height: 3.2, frontHeight: 1.8 }, 2],
    ['garden.planter', {}, 1],
    ['garden.shrub', {}, 1],
    ['garden.shrub', { diameter: 3, height: 3, flowers: 'roses' }, 1],
    ['garden.grass', {}, 1],
    ['garden.grass', { diameter: 1.5, height: 2.5 }, 1],
    ['garden.hedge', {}, 1],
    ['garden.hedge', { width: 12, depth: 1.5, height: 3 }, 1],
    ['garden.hedge', { width: 0.5, depth: 0.3, height: 0.4 }, 1],
    ['garden.tree', {}, 1],
    ['garden.tree', { diameter: 8, height: 12, trunkHeight: 4 }, 1],
    ['garden.tree', { diameter: 1, height: 2, trunkHeight: 4 }, 1],
    ['garden.log', {}, 1],
    ['garden.rock-pile', {}, 1],
    ['garden.rock-pile', { width: 6, depth: 3, height: 1.5 }, 1],
    ['garden.rock-pile', { width: 0.4, depth: 0.3, height: 0.2 }, 1],
    ['garden.stepping-stone', {}, 1],
    ['garden.bird-house', {}, 1],
    ['garden.bird-house', { height: 2, color: '#6b4a2b' }, 2],
    ['garden.bin', {}, 1],
    ['garden.bin', { width: 0.8, depth: 1.1, height: 1.3, color: '#4a5a3c' }, 1],
    ['garden.bin', { width: 0.45, depth: 0.5, height: 0.85 }, 1],
    ['garden.pillar', {}, 1],
    ['garden.pillar', { diameter: 1, height: 2.5 }, 1],
    ['garden.kerb', {}, 1],
    ['garden.kerb', { width: 15, depth: 0.06, height: 0.08 }, 1],
  ] as [string, Record<string, unknown>, number][])(
    '%s %j is %i mesh(es), within a piece\u2019s triangles, on the ground',
    (id, overrides, meshes) => {
      const parts = draw(id, overrides);
      expect(partBatches(parts)).toHaveLength(meshes);
      expect(trianglesOf(parts)).toBeLessThanOrEqual(BUDGETS.trianglesPerPiece);
      // A leaning leg or blade dips a few millimetres into the ground at its foot.
      expect(boundsOf(parts).min[1]).toBeGreaterThanOrEqual(-0.01);
      for (const part of parts)
        for (const n of [...part.center, ...part.size]) expect(Number.isFinite(n)).toBe(true);
    },
  );

  it.each([
    ['garden.shrub', { diameter: 1.1, height: 1.6, flowers: 'roses' }],
    ['garden.shrub', {}],
    ['garden.grass', { diameter: 0.7, height: 1.4 }],
    ['garden.grass', { diameter: 0.2, height: 2.5 }],
    ['garden.stepping-stone', { diameter: 0.6 }],
    ['garden.tree', {}],
    ['garden.tree', { diameter: 8, height: 12, trunkHeight: 4 }],
    ['garden.tree', { diameter: 1, height: 2, trunkHeight: 4 }],
    ['garden.hedge', {}],
    ['garden.hedge', { width: 12, depth: 1.5, height: 3 }],
    ['garden.hedge', { width: 0.5, depth: 0.3, height: 0.4 }],
    ['garden.table', { width: 1.2, depth: 0.8 }],
    ['garden.bench', {}],
  ] as [string, Record<string, unknown>][])('%s %j stays within its size', (id, overrides) => {
    const type = catalog.get(id)!;
    const size = furnitureSize(effectiveParams(type, overrides).values);
    const { min, max } = boundsOf(draw(id, overrides));
    // Flowers stand a few centimetres proud of the leaves.
    const slack = id === 'garden.shrub' ? 0.06 : 1e-6;
    expect(min[0]).toBeGreaterThanOrEqual(-size.width / 2 - slack);
    expect(max[0]).toBeLessThanOrEqual(size.width / 2 + slack);
    expect(max[2]).toBeLessThanOrEqual(size.depth / 2 + slack);
    expect(max[1]).toBeLessThanOrEqual(size.height + 1e-6);
    if (id !== 'garden.bench') expect(min[2]).toBeGreaterThanOrEqual(-size.depth / 2 - slack);
  });

  it.each([{}, { width: 12, depth: 1.5, height: 3 }, { width: 0.5 }, { width: 7.4, height: 0.4 }])(
    'a hedge %j is a row of rounded blocks from end to end, each reaching into the next',
    (overrides) => {
      const type = catalog.get('garden.hedge')!;
      const size = furnitureSize(effectiveParams(type, overrides).values);
      const blocks = draw('garden.hedge', overrides);
      expect(blocks.every((b) => b.shape === 'roundedBox' && !b.material)).toBe(true);
      expect(blocks.length).toBeLessThanOrEqual(12);
      const ends = blocks.map((b) => [b.center[0] - b.size[0] / 2, b.center[0] + b.size[0] / 2]);
      expect(ends[0]![0]).toBeCloseTo(-size.width / 2);
      expect(ends.at(-1)![1]).toBeCloseTo(size.width / 2);
      // Nothing floats: each block overlaps the one before it, and all stand on the ground.
      ends.slice(1).forEach(([from], i) => expect(from).toBeLessThan(ends[i]![1]! - 0.1));
      for (const b of blocks) {
        expect(b.center[1] - b.size[1] / 2).toBeCloseTo(0);
        expect(b.size[1]).toBeGreaterThan(size.height * 0.94);
        expect(b.size[2]).toBeGreaterThan(size.depth * 0.9);
      }
      expect(Math.max(...blocks.map((b) => b.size[1]))).toBeLessThanOrEqual(size.height);
    },
  );

  it.each([
    {},
    { diameter: 8, height: 12, trunkHeight: 4 },
    { diameter: 1, height: 2, trunkHeight: 4 },
  ])(
    'a tree %j is a trunk that goes into its crown, and a crown that reaches its size',
    (overrides) => {
      const type = catalog.get('garden.tree')!;
      const values = effectiveParams(type, overrides).values;
      const size = furnitureSize(values);
      const [trunk, middle, ...clumps] = draw('garden.tree', overrides);
      // The clear height is the parameter's, or at most six tenths of the tree.
      const clear = Math.min(Number(values.trunkHeight), size.height * 0.6);
      expect(trunk!.role).toBe('post');
      expect(middle!.center[1] - middle!.size[1] / 2).toBeCloseTo(clear);
      // Nothing floats: the trunk ends inside the crown's middle, and every clump starts in it.
      expect(trunk!.size[1]).toBeGreaterThan(clear + 0.1);
      expect(trunk!.size[1]).toBeLessThan(middle!.center[1] + middle!.size[1] / 2);
      expect(clumps).toHaveLength(6);
      for (const clump of clumps) {
        const inner = Math.hypot(clump.center[0], clump.center[2]) - clump.size[0] / 2;
        expect(inner).toBeLessThan(middle!.size[0] / 2 - 0.02);
        expect(clump.center[1] - clump.size[1] / 2).toBeGreaterThanOrEqual(clear);
      }
      const { min, max } = boundsOf([trunk!, middle!, ...clumps]);
      expect(max[1]).toBeCloseTo(size.height);
      expect(max[0] - min[0]).toBeGreaterThan(size.width * 0.9);
      // Open, like the pergola: one walks and sits under a tree.
      expect(type.footprint).toBe('none');
    },
  );

  it('a chair is a frame of bent tubes with a woven sling for its seat and its back', () => {
    const parts = draw('garden.chair');
    const tubes = parts.filter((p) => p.shape === 'extrude');
    expect(tubes).toHaveLength(4);
    expect(tubes.every((p) => p.material?.finish === 'metal.brushed')).toBe(true);
    const sling = parts.filter((p) => p.material?.finish === 'fabric.weave');
    expect(sling).toHaveLength(2);
    // The armrests lie 20 cm over the seat.
    const { max } = boundsOf([tubes[0]!]);
    expect(max[1]).toBeCloseTo(0.45 + 0.2 + 0.0125);
    // The frame stands on the ground at the footprint's front.
    const all = boundsOf(parts);
    expect(all.max[2]).toBeCloseTo(0.31);
    expect(all.max[1]).toBeCloseTo(1.05, 1);
  });

  it('a table\u2019s glass top has rounded corners and is drawn last', () => {
    const parts = draw('garden.table');
    const top = parts.at(-1)!;
    expect(top.shape).toBe('extrude');
    expect(top.material).toMatchObject({ finish: 'glass.clear', transparent: true, opacity: 0.6 });
    expect(parts.filter((p) => p.role === 'frame')).toHaveLength(8);
  });

  it('a bench\u2019s seat slats run along it, grain and all', () => {
    const parts = draw('garden.bench', { color: '#6b4a2b' });
    const slats = parts.filter((p) => p.rotationY === Math.PI / 2);
    expect(slats).toHaveLength(4);
    expect(slats.every((p) => p.material?.finish === 'wood.veneer')).toBe(true);
    // The default grey is lighter than oak: lacquer.
    expect(draw('garden.bench')[0]!.material).toEqual({ finish: 'plastic.matt' });
  });

  it('a pergola\u2019s roof is a corrugated sheet across its width, on the rafters\u2019 slope', () => {
    const parts = draw('garden.pergola');
    const roof = parts.at(-1)!;
    expect(roof.role).toBe('panel');
    expect(roof.shape).toBe('extrude');
    expect(roof.size[0]).toBeCloseTo(3.2 + 0.1);
    // Waves of 1.2 cm to each side, 4 mm thick: more than a flat sheet, far less than a rafter.
    expect(roof.size[1]).toBeGreaterThan(0.024);
    expect(roof.size[1]).toBeLessThan(0.035);
    expect(roof.rotationX).toBeCloseTo(Math.atan2(2.45 - 2.15, 2.6));
  });

  it('nothing floats: the table\u2019s rails end under its glass, the pergola\u2019s sheet lies on its rafters, the bench\u2019s slats lean on its posts', () => {
    const table = draw('garden.table');
    const glass = boundsOf([table.at(-1)!]);
    for (const rail of table.filter((p) => p.role === 'frame' && p.size[1] === 0.05))
      expect(rail.center[1] + rail.size[1] / 2).toBeCloseTo(glass.min[1]);
    // Along the roof's normal the sheet's troughs are where the rafters' tops are (2 mm in them).
    const pergola = draw('garden.pergola');
    const sheet = pergola.at(-1)!;
    const rafter = pergola.find((p) => p.rotationX !== undefined && p.role === 'frame')!;
    expect(sheet.center[1] - sheet.size[1] / 2).toBeLessThanOrEqual(
      rafter.center[1] + rafter.size[1] / 2,
    );
    expect(sheet.center[1] - sheet.size[1] / 2).toBeGreaterThan(
      rafter.center[1] + rafter.size[1] / 2 - 0.005,
    );
    // The bench's posts stand behind the back slats and touch them.
    const bench = draw('garden.bench');
    const posts = bench.filter((p) => p.rotationX !== undefined && p.role === 'frame');
    const slats = bench.filter((p) => p.rotationX !== undefined && p.role === 'body');
    expect(posts).toHaveLength(2);
    expect(slats).toHaveLength(3);
    const middle = slats[1]!;
    // At the middle slat's height the post's centre line is this far behind the slat's.
    const at = (p: Part, y: number) => p.center[2] + (y - p.center[1]) * Math.tan(-0.2);
    const behind = at(middle, middle.center[1]) - at(posts[0]!, middle.center[1]);
    expect(behind).toBeGreaterThan(0.02);
    expect(behind).toBeLessThanOrEqual((0.025 + 0.03) / 2 / Math.cos(0.2));
  });

  it('a shrub is a middle with clumps around it; its roses sit on the clumps', () => {
    const parts = draw('garden.shrub', { flowers: 'roses' });
    const leaves = parts.filter((p) => p.role === 'body');
    expect(leaves).toHaveLength(8);
    expect(leaves.every((p) => p.shape === 'lathe')).toBe(true);
    const flowers = parts.filter((p) => p.role === 'detail');
    for (const f of flowers) {
      // Within a clump's box, grown by the flower.
      const on = leaves.slice(1).some((c) => {
        const { min, max } = boundsOf([c]);
        return [0, 1, 2].every(
          (k) => f.center[k]! > min[k]! - 0.05 && f.center[k]! < max[k]! + 0.05,
        );
      });
      expect(on).toBe(true);
    }
    expect(draw('garden.shrub', { flowers: 'roses' })).toEqual(parts);
  });

  it('grass is tapering blades, the first upright at the clump\u2019s full height', () => {
    const parts = draw('garden.grass');
    const blades = parts.filter((p) => p.shape === 'extrude');
    expect(blades).toHaveLength(24);
    expect(blades[0]!.rotationX).toBe(0);
    expect(boundsOf([blades[0]!]).max[1]).toBeCloseTo(1.2);
    for (const b of blades.slice(1)) expect(b.rotationX).toBeGreaterThan(0);
  });

  it('a log shows its cut at both ends: three rings, each proud of the one around it', () => {
    const parts = draw('garden.log');
    expect(parts).toHaveLength(7);
    const right = parts.slice(4).map((p) => boundsOf([p]).max[0]);
    expect(right[0]!).toBeLessThan(right[1]!);
    expect(right[1]!).toBeLessThan(right[2]!);
    expect(right[2]).toBeCloseTo(0.4);
    expect(boundsOf(parts).min[0]).toBeCloseTo(-0.4);
    // The cut lies inside the bark.
    expect(parts[4]!.size[0]).toBeLessThan(parts[0]!.size[0]);
  });

  it('a large rock pile is made of larger stones, not of more of them', () => {
    const small = draw('garden.rock-pile', { width: 1.8, depth: 1, height: 0.6 });
    const large = draw('garden.rock-pile', { width: 6, depth: 3, height: 1.5 });
    expect(small.length / 2).toBeGreaterThan(30);
    expect(large.length / 2).toBeLessThan(100);
    const { min, max } = boundsOf(large);
    expect(max[1]).toBeLessThan(1.5 * 1.2);
    expect(min[0]).toBeGreaterThan(-3.6);
    expect(max[0]).toBeLessThan(3.6);
  });

  it('a stepping stone is a disc with a worn upper edge', () => {
    const [stone] = draw('garden.stepping-stone', { diameter: 0.6 });
    expect(stone!.shape).toBe('lathe');
    expect(stone!.size).toEqual([0.6, 0.03, 0.6]);
    expect(partShape(stone!).closed).toBe(true);
  });

  it('a bird house has its entrance and a perch on its front', () => {
    const parts = draw('garden.bird-house');
    const round = parts.filter((p) => p.shape === 'cylinder');
    expect(round).toHaveLength(2);
    for (const p of round) expect(boundsOf([p]).max[2]).toBeGreaterThan(0.16);
    expect(boundsOf(parts).max[1]).toBeCloseTo(1.5);
  });
});
