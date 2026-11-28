import { HomeModel, HomeSeed } from '@my-home/shared';
import type { BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import homeJson from '../../../../data/homes/home.json';
import seedJson from '../../../../data/homes/home.seed.json';
import { buildHome } from '../builder/buildHome';
import type { Vec3 } from '../geom/types';
import { groupShown, shellItems, type DrawItem } from '../builder/drawList';
import { wholeVisibility } from '../builder/visibility';
import { furniture } from '../catalog/furniture';
import { createContext, defaultSettings } from '../editor/operations';
import { furnitureViews } from '../scene/furnitureViews';
import { CAP_OVERLAP, capped, capQuad, capSolids, furnitureItems, homeItems } from './caps';
import { LOOKS, sectionPlane, sectionRange } from './named';

const model = HomeModel.parse(structuredClone(homeJson));
const seed = HomeSeed.parse(structuredClone(seedJson));
const home = buildHome(model);
const ctx = createContext(model, furniture, defaultSettings);
const placed = furnitureViews(
  ctx,
  seed.placements.map((p) => ({ ...p, params: { ...p.params } })),
  home,
  wholeVisibility(home),
);
const items = [...homeItems(home), ...furnitureItems(placed)];
const solids = capSolids(items);

/**
 * What the stencil counts along a ray from `from` in direction `d`: a face the ray leaves through
 * adds one, a face it enters through takes one away. For closed solids that is the number of
 * solids `from` is inside of, whatever the direction.
 */
function count(geometries: BufferGeometry[], from: Vec3, d: Vec3): number {
  let total = 0;
  for (const g of geometries) {
    const p = g.getAttribute('position').array as Float32Array;
    for (let i = 0; i < p.length; i += 9) {
      const [ax, ay, az] = [p[i]!, p[i + 1]!, p[i + 2]!];
      const [e1x, e1y, e1z] = [p[i + 3]! - ax, p[i + 4]! - ay, p[i + 5]! - az];
      const [e2x, e2y, e2z] = [p[i + 6]! - ax, p[i + 7]! - ay, p[i + 8]! - az];
      // Möller–Trumbore.
      const [px, py, pz] = [
        d[1] * e2z - d[2] * e2y,
        d[2] * e2x - d[0] * e2z,
        d[0] * e2y - d[1] * e2x,
      ];
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const [tx, ty, tz] = [from[0] - ax, from[1] - ay, from[2] - az];
      const u = (tx * px + ty * py + tz * pz) / det;
      if (u < 0 || u > 1) continue;
      const [qx, qy, qz] = [ty * e1z - tz * e1y, tz * e1x - tx * e1z, tx * e1y - ty * e1x];
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) / det;
      if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) / det;
      if (t <= 0) continue;
      // det > 0: the triangle faces the ray's origin, the ray enters there.
      total += det > 0 ? -1 : 1;
    }
  }
  return total;
}

/** Numbers in [0, 1) that are the same on every run. */
function random(seedValue: number) {
  let s = seedValue;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const geometriesOf = (cap: 'soil' | 'dark') =>
  solids.filter((s) => s.cap === cap).map((s) => s.geometry);

describe('what a section caps', () => {
  it('closed solids that are drawn opaque: not floors and lawns, not glass or wire mesh', () => {
    const shell = shellItems(home);
    expect(shell.filter((i) => i.shape.kind === 'surface').some(capped)).toBe(false);
    const glass = items.filter((i) => i.material?.transparent);
    expect(glass.length).toBeGreaterThan(10);
    expect(glass.some(capped)).toBe(false);
    expect(
      shell
        .filter(
          (i) =>
            i.shape.kind !== 'surface' && i.shape.kind !== 'polygon' && !i.material?.transparent,
        )
        .every(capped),
    ).toBe(true);
  });

  it('the terrain takes the soil cap, everything else the dark one', () => {
    const soil = solids.filter((s) => s.cap === 'soil');
    expect(soil).toHaveLength(1);
    expect(soil[0]).toMatchObject({ group: { kind: 'terrain' }, items: home.terrain.length });
    const dark = solids.filter((s) => s.cap === 'dark');
    // A wall is drawn as faces, which are no solids: it is counted as its solid stretches.
    expect(items.filter((i) => i.shape.kind === 'polygon').some(capped)).toBe(false);
    for (const wall of home.walls) expect(items.filter((i) => i.id === wall.id)).toHaveLength(1);
    expect(dark.reduce((n, s) => n + s.items, 0)).toBe(
      items.filter(capped).length - home.terrain.length,
    );
  });

  it('is a few meshes: one per level and apartment, slab, roof; fences, outbuildings and furniture as one each', () => {
    expect(solids.length).toBeLessThanOrEqual(20);
    const always = solids.filter((s) => !s.group);
    expect(always.map((s) => s.key).sort()).toEqual(['dark|placement', 'dark|structure']);
    // What is hidden with a level is not capped: every other mesh follows a group of the home.
    const hidden = { ...wholeVisibility(home), hiddenLevels: ['first-floor'] };
    const shown = solids.filter((s) => !s.group || groupShown(s.group, home, hidden));
    expect(shown.length).toBeLessThan(solids.length);
  });
});

describe('the count a cap is drawn by', () => {
  it('is the same along any ray: the counted solids are closed, also where walls meet and open', () => {
    const next = random(114);
    const { min, max } = home.bounds;
    const direction = (): Vec3 => {
      const [a, b] = [next() * Math.PI * 2, next() * 2 - 1];
      const r = Math.sqrt(1 - b * b);
      return [r * Math.cos(a), b, r * Math.sin(a)];
    };
    for (const cap of ['soil', 'dark'] as const) {
      const geometries = geometriesOf(cap);
      let inside = 0;
      for (let n = 0; n < 60; n++) {
        const point: Vec3 = [
          min[0] + next() * (max[0] - min[0]),
          min[1] + next() * (max[1] - min[1]),
          min[2] + next() * (max[2] - min[2]),
        ];
        const first = count(geometries, point, direction());
        expect(first, `${cap} at ${point.join(', ')}`).toBeGreaterThanOrEqual(0);
        expect(count(geometries, point, direction()), `${cap} at ${point.join(', ')}`).toBe(first);
        if (first > 0) inside += 1;
      }
      // The sample is worth something: some points are inside a solid, some are not.
      expect(inside, cap).toBeGreaterThan(0);
      expect(inside, cap).toBeLessThan(60);
    }
  });

  it('is not zero inside a wall and zero in the air of a room', () => {
    const dark = geometriesOf('dark');
    const ray: Vec3 = [0.36, 0.48, 0.8];
    for (const wall of home.walls.filter((w) => !w.outline).slice(0, 25))
      expect(count(dark, wall.center, ray), wall.id).toBeGreaterThan(0);
    for (const room of home.roomFloors.filter((r) => r.levelId === 'souterrain')) {
      const [x, y, z] = room.labelAt;
      // Above the furniture, below the ceiling and any lowered one.
      expect(count(dark, [x, y + 1.85, z], ray), room.roomId).toBe(0);
    }
    // Under the lawn there is soil, and no soil in a room.
    const soil = geometriesOf('soil');
    const lawn = home.terrain.find((t) => t.id === 'terrain-south')!;
    const [lx, lz] = lawn.outline[0]!;
    expect(count(soil, [lx + 0.5, lawn.top - 0.5, lz + 0.5], ray)).toBeGreaterThanOrEqual(0);
    const kitchen = home.roomFloors.find((r) => r.roomId === 'souterrain-kitchen')!.labelAt;
    expect(count(soil, [kitchen[0], kitchen[1] + 1, kitchen[2]], ray)).toBe(0);
  });
});

describe('solids that touch', () => {
  it('are counted a hair larger than they are drawn, so no seam is left between them', () => {
    // Two boxes, one on the other: at the height where they meet, inside both footprints.
    const stacked = (y: number): DrawItem => ({
      id: `box-${y}`,
      group: { kind: 'structure', id: 's' },
      shape: { kind: 'box', size: [2, 1, 0.3] },
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, y, 0, 1],
      finish: 'paint.plain',
      tint: '#ffffff',
      castShadow: true,
      receiveShadow: true,
      closed: true,
    });
    const [pair] = capSolids([stacked(0.5), stacked(1.5)]);
    expect(pair!.items).toBe(2);
    expect(count([pair!.geometry], [0.3, 1, 0], [0, 0, 1])).toBe(2);
    expect(count([pair!.geometry], [0.3, 1 + CAP_OVERLAP / 2, 0.01], [0.1, 0.2, 1])).toBe(2);
    // And no further than that hair.
    expect(count([pair!.geometry], [1 + 2 * CAP_OVERLAP, 1, 0], [0, 0, 1])).toBe(0);
    pair!.geometry.dispose();
  });
});

describe('the quad of a cap', () => {
  it.each(LOOKS)('lies in the cut plane looking %s and reaches past the plot', (look) => {
    const at = sectionRange(home, look).depth / 3;
    const plane = sectionPlane(home, { look, at });
    const quad = capQuad(plane, home.bounds, [1, 1, 1]);
    const position = quad.getAttribute('position');
    const normal = quad.getAttribute('normal');
    const [nx, , nz] = plane.normal;
    const { min, max } = home.bounds;
    let [low, high, left, right] = [Infinity, -Infinity, Infinity, -Infinity];
    for (let i = 0; i < position.count; i++) {
      const [x, y, z] = [position.getX(i), position.getY(i), position.getZ(i)];
      expect(nx * x + nz * z + plane.constant).toBeCloseTo(0, 5);
      // It faces the camera: against the look.
      expect(normal.getX(i)).toBeCloseTo(-nx);
      expect(normal.getZ(i)).toBeCloseTo(-nz);
      const across = -nz * x + nx * z;
      [low, high] = [Math.min(low, y), Math.max(high, y)];
      [left, right] = [Math.min(left, across), Math.max(right, across)];
    }
    expect(low).toBeLessThan(min[1]);
    expect(high).toBeGreaterThan(max[1]);
    expect(right - left).toBeGreaterThan(Math.max(max[0] - min[0], max[2] - min[2]));
    // Texture coordinates in metres.
    const uv = quad.getAttribute('uv');
    expect(uv.getX(1) - uv.getX(0)).toBeCloseTo(right - left, 4);
    expect(uv.getY(2) - uv.getY(1)).toBeCloseTo(high - low, 4);
  });
});
