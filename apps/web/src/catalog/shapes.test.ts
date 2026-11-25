import { catalog, defaultParams, effectiveParams, furnitureSize } from '@my-home/shared';
import { Box3, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { IDENTITY, partItems, partShape, ROUNDED_SEGMENTS, transform } from '../builder/drawList';
import { previewContext, previewParts } from '../catalog-page/preview';
import { boundsOf } from '../piece-page/Inspector';
import { cutParts } from '../piece-page/section';
import { BUDGETS } from '../quality/perfReport';
import { batches, shapeGeometry } from '../scene/batches';
import { furniture } from './furniture';
import { partBatches } from './PartsMesh';
import { box, cylinder, extrude, lathe, roundedBox, tilted } from './parts';
import { pieces } from './registry';
import type { Part } from './types';

/**
 * The part shapes of docs/design/realistic-render.md §8.2: rounded boxes, extruded outlines and
 * lathed profiles, from the helper to the geometry, and the three types that use them.
 */

const geometryOf = (part: Part) => shapeGeometry(partShape(part).shape);
const triangles = (g: BufferGeometry) =>
  (g.index ? g.index.count : g.getAttribute('position').count) / 3;
const extent = (g: BufferGeometry) =>
  new Box3().setFromBufferAttribute(g.getAttribute('position') as never).getSize(new Vector3());

/** Every triangle's own normal agrees with the normals of its corners: the faces look outwards. */
function facesAgreeWithNormals(g: BufferGeometry) {
  const position = g.getAttribute('position');
  const normal = g.getAttribute('normal');
  const corner = (i: number) => (g.index ? g.index.getX(i) : i);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  const face = new Vector3();
  for (let t = 0; t < triangles(g); t++) {
    const [i, j, k] = [corner(t * 3), corner(t * 3 + 1), corner(t * 3 + 2)];
    a.fromBufferAttribute(position, i);
    face.crossVectors(
      b.fromBufferAttribute(position, j).sub(a),
      c.fromBufferAttribute(position, k).sub(a),
    );
    // A triangle at a lathe's axis or between a doubled point has no area and no side.
    if (face.length() < 1e-12) continue;
    n.fromBufferAttribute(normal, i)
      .add(b.fromBufferAttribute(normal, j))
      .add(c.fromBufferAttribute(normal, k));
    if (face.dot(n) <= 0) return false;
  }
  return true;
}

describe('part helpers', () => {
  it('a rounded box is a box with a radius, at most half its smallest side', () => {
    const part = roundedBox([1, 2, 3], [0.4, 0.2, 0.6], 0.02, '#112233', 'body');
    expect(part).toEqual({
      ...box([1, 2, 3], [0.4, 0.2, 0.6], '#112233', 'body'),
      shape: 'roundedBox',
      radius: 0.02,
    });
    expect(roundedBox([0, 0, 0], [0.4, 0.2, 0.6], 5, '#112233', 'body')).toMatchObject({
      radius: 0.1,
    });
    expect(roundedBox([0, 0, 0], [0.4, 0.2, 0.6], -1, '#112233', 'body')).toMatchObject({
      radius: 0,
    });
  });

  it('an extruded outline is centred on the box around it', () => {
    const part = extrude(
      [1, 1, 1],
      [
        [0, 0],
        [0.3, 0],
        [0.3, 0.1],
        [0, 0.1],
      ],
      0.5,
      '#112233',
      'detail',
    );
    expect(part).toMatchObject({ shape: 'extrude', rotationY: 0, size: [0.3, 0.1, 0.5] });
    expect(part.center.map((n) => +n.toFixed(9))).toEqual([1.15, 1.05, 1]);
    expect(
      part.shape === 'extrude' && part.profile.map((p) => p.map((n) => +n.toFixed(9))),
    ).toEqual([
      [-0.15, -0.05],
      [0.15, -0.05],
      [0.15, 0.05],
      [-0.15, 0.05],
    ]);
  });

  it('an extruded outline turns about its origin, not about its middle', () => {
    // Turned by -90°, the outline's x runs along the piece's z.
    const part = extrude(
      [1, 1, 1],
      [
        [0, 0],
        [0.3, 0],
        [0.3, 0.1],
        [0, 0.1],
      ],
      0.5,
      '#112233',
      'detail',
      -Math.PI / 2,
    );
    expect(part.center.map((n) => +n.toFixed(9))).toEqual([1, 1.05, 1.15]);
    const [item] = partItems([part], 'p', { kind: 'placement', id: 'p' }, IDENTITY);
    const g = shapeGeometry(item!.shape);
    g.applyMatrix4({ elements: item!.matrix } as never);
    const bounds = new Box3().setFromBufferAttribute(g.getAttribute('position') as never);
    expect(bounds.min.toArray().map((n) => +n.toFixed(6))).toEqual([0.75, 1, 1]);
    expect(bounds.max.toArray().map((n) => +n.toFixed(6))).toEqual([1.25, 1.1, 1.3]);
  });

  it('a lathed profile is centred on its height and as wide as its widest point', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const part = lathe(
      [0, 1, 0],
      [
        [0, 0],
        [0.2, 0],
        [0.3, 0.4],
        [-1, 0.4],
      ],
      '#112233',
      'body',
    );
    expect(part).toMatchObject({ shape: 'lathe', center: [0, 1.2, 0], size: [0.6, 0.4, 0.6] });
    // A radius is never negative, and a module that gives one is told in development.
    expect(warn).toHaveBeenCalledWith('lathe: a negative radius is drawn as 0', expect.anything());
    warn.mockRestore();
    expect(part.shape === 'lathe' && part.profile).toEqual([
      [0, -0.2],
      [0.2, -0.2],
      [0.3, 0.2],
      [0, 0.2],
    ]);
  });
});

describe('the draw shapes of parts', () => {
  const group = { kind: 'placement', id: 'p' } as const;

  it('boxes and cylinders are the draw items they were', () => {
    const [b, c] = partItems(
      [
        box([0, 0, 0], [1, 2, 3], '#112233', 'body'),
        cylinder([0, 0, 0], 1, 2, '#112233', 'body', 0.5),
      ],
      'p',
      group,
    );
    expect(b).toEqual({
      id: 'p/0',
      group,
      piece: 'p',
      shape: { kind: 'box', size: [1, 2, 3] },
      matrix: transform([0, 0, 0]),
      finish: 'part',
      tint: '#112233',
      castShadow: true,
      receiveShadow: true,
      closed: true,
    });
    expect(c!.shape).toEqual({ kind: 'cylinder', diameter: 1, height: 2 });
    // Elliptic: scaled along z.
    expect(c!.matrix[10]).toBe(0.5);
  });

  it('a rounded box, an extruded outline and a closed lathe are closed solids', () => {
    const parts = [
      roundedBox([0, 0, 0], [1, 1, 1], 0.1, '#112233', 'body'),
      extrude(
        [0, 0, 0],
        [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
        1,
        '#112233',
        'body',
      ),
      lathe(
        [0, 0, 0],
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
        '#112233',
        'body',
      ),
      // A ring: it ends where it starts.
      lathe(
        [0, 0, 0],
        [
          [1, 0],
          [1.1, 0],
          [1.1, 1],
          [1, 1],
          [1, 0],
        ],
        '#112233',
        'body',
      ),
    ];
    const items = partItems(parts, 'p', group);
    expect(items.map((i) => i.shape.kind)).toEqual(['roundedBox', 'profile', 'lathe', 'lathe']);
    expect(items.every((i) => i.closed && i.material === undefined)).toBe(true);
    expect(batches(items)).toHaveLength(1);
  });

  it('a lathe that all but closes is closed: computed profiles need not meet to the last bit', () => {
    const ring = lathe(
      [0, 0, 0],
      [
        [1, 0],
        [1.1, 0],
        [1.1, 1],
        [1, 1],
        [1, 0.1 + 0.2 - 0.3],
      ],
      '#112233',
      'body',
    );
    expect(partShape(ring).closed).toBe(true);
    const solid = lathe(
      [0, 0, 0],
      [
        [1e-9, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      '#112233',
      'body',
    );
    expect(partShape(solid).closed).toBe(true);
    expect(
      partShape(
        lathe(
          [0, 0, 0],
          [
            [0.001, 0],
            [1, 1],
          ],
          '#112233',
          'body',
        ),
      ).closed,
    ).toBe(false);
  });

  it('an open lathe is a skin drawn from both sides, in a mesh of its own', () => {
    const shade = lathe(
      [0, 0, 0],
      [
        [0.2, 0],
        [0.1, 0.2],
      ],
      '#112233',
      'body',
      { roughness: 0.5 },
    );
    const [item] = partItems([shade], 'p', group);
    expect(item).toMatchObject({ closed: false, material: { roughness: 0.5, doubleSided: true } });
    expect(partShape(shade).closed).toBe(false);
  });

  it('a tilted part of a new shape is tilted like a box', () => {
    const matrixOf = (part: Part) => partItems([tilted(part, 0.3)], 'p', group)[0]!.matrix;
    expect(matrixOf(roundedBox([0, 1, 0], [1, 1, 1], 0.1, '#112233', 'body'))).toEqual(
      matrixOf(box([0, 1, 0], [1, 1, 1], '#112233', 'body')),
    );
  });
});

describe('the geometry of the part shapes', () => {
  it('a rounded box fills its size, in 300 triangles, with unit normals that look outwards', () => {
    const g = geometryOf(roundedBox([0, 0, 0], [0.5, 0.3, 0.4], 0.05, '#112233', 'body'));
    expect(
      extent(g)
        .toArray()
        .map((n) => +n.toFixed(6)),
    ).toEqual([0.5, 0.3, 0.4]);
    expect(triangles(g)).toBe(6 * 2 * (2 * ROUNDED_SEGMENTS + 1) ** 2);
    expect(triangles(g)).toBe(300);
    const [position, normal] = [g.getAttribute('position'), g.getAttribute('normal')];
    const [p, n] = [new Vector3(), new Vector3()];
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i);
      n.fromBufferAttribute(normal, i);
      expect(n.length()).toBeCloseTo(1, 6);
      // Every vertex lies `radius` out from the inner box, along its normal.
      const inner = p.clone().addScaledVector(n, -0.05);
      expect(Math.abs(inner.x)).toBeLessThanOrEqual(0.2 + 1e-6);
      expect(Math.abs(inner.y)).toBeLessThanOrEqual(0.1 + 1e-6);
      expect(Math.abs(inner.z)).toBeLessThanOrEqual(0.15 + 1e-6);
    }
    expect(facesAgreeWithNormals(g)).toBe(true);
    // The flat of a face is flat: the vertices of the face's middle look straight out.
    const flat = [...Array(position.count).keys()].filter(
      (i) => Math.abs(normal.getY(i) - 1) < 1e-9,
    );
    expect(flat.length).toBeGreaterThanOrEqual(4);
    expect(flat.every((i) => Math.abs(position.getY(i) - 0.15) < 1e-6)).toBe(true);
  });

  it('a rounded box without a radius is the plain box', () => {
    const g = geometryOf(roundedBox([0, 0, 0], [0.5, 0.3, 0.4], 0, '#112233', 'body'));
    expect(triangles(g)).toBe(12);
  });

  it('an extruded outline fills its size and looks outwards, whichever way it winds', () => {
    const outline: [number, number][] = [
      [0, 0],
      [0.3, 0],
      [0.3, 0.1],
      [0.1, 0.1],
      [0.1, 0.4],
      [0, 0.4],
    ];
    for (const o of [outline, [...outline].reverse()]) {
      const g = geometryOf(extrude([0, 0, 0], o, 0.5, '#112233', 'detail'));
      expect(
        extent(g)
          .toArray()
          .map((n) => +n.toFixed(6)),
      ).toEqual([0.3, 0.4, 0.5]);
      // Two caps of n - 2 triangles and two triangles a side.
      expect(triangles(g)).toBe(4 * o.length - 4);
      expect(facesAgreeWithNormals(g)).toBe(true);
    }
  });

  it('a lathed profile fills its size and looks outwards when it runs up the outside', () => {
    const g = geometryOf(
      lathe(
        [0, 0, 0],
        [
          [0, 0],
          [0.2, 0],
          [0.2, 0],
          [0.3, 0.4],
          [0.3, 0.4],
          [0, 0.4],
        ],
        '#112233',
        'body',
      ),
    );
    expect(
      extent(g)
        .toArray()
        .map((n) => +n.toFixed(6)),
    ).toEqual([0.6, 0.4, 0.6]);
    expect(triangles(g)).toBe(5 * 24 * 2);
    expect(facesAgreeWithNormals(g)).toBe(true);
    // A point given twice is a sharp edge: the base looks straight down right up to its rim.
    const [position, normal] = [g.getAttribute('position'), g.getAttribute('normal')];
    const base = [...Array(position.count).keys()].filter((i) => normal.getY(i) < -0.999);
    expect(base.some((i) => Math.hypot(position.getX(i), position.getZ(i)) > 0.19)).toBe(true);
  });

  it('the size of every part of every type is the box around its geometry', () => {
    for (const type of catalog.types) {
      for (const part of previewParts(type)) {
        const size = extent(geometryOf(part)).toArray();
        // An elliptic cylinder is a round one scaled along z.
        if (part.shape === 'cylinder') size[2] = part.size[2];
        size.forEach((n, i) => expect(n, `${type.id} ${part.shape}`).toBeCloseTo(part.size[i]!, 6));
      }
    }
  });
});

describe('the new shapes on the piece page', () => {
  it('are framed by their size', () => {
    const parts = [
      extrude(
        [0, 0, 0],
        [
          [0, 0],
          [0.3, 0],
          [0.3, 0.1],
        ],
        0.5,
        '#112233',
        'detail',
      ),
      lathe(
        [1, 0, 0],
        [
          [0, 0],
          [0.2, 0.4],
        ],
        '#112233',
        'body',
      ),
    ];
    const { min, max } = boundsOf(parts);
    expect(min.map((n) => +n.toFixed(6))).toEqual([0, 0, -0.25]);
    expect(max.map((n) => +n.toFixed(6))).toEqual([1.2, 0.4, 0.25]);
  });

  it('a section cuts a rounded box and an extruded outline by their box, a lathe by its cylinder', () => {
    const cut = cutParts([
      roundedBox([0, 0.5, 0], [1, 1, 0.4], 0.1, '#112233', 'body'),
      extrude(
        [-0.5, 0, 1],
        [
          [0, 0],
          [1, 0],
          [0, 0.2],
        ],
        0.3,
        '#112233',
        'detail',
      ),
      lathe(
        [0.3, 0, 2],
        [
          [0, 0],
          [0.5, 0],
          [0.5, 1],
          [0, 1],
        ],
        '#112233',
        'post',
      ),
      // Beside the plane: not cut.
      lathe(
        [2, 0, 0],
        [
          [0, 0],
          [0.5, 1],
        ],
        '#112233',
        'post',
      ),
    ]);
    expect(
      cut.map((s) =>
        [s.role, ...s.z, ...s.y].map((n) => (typeof n === 'number' ? +n.toFixed(6) : n)),
      ),
    ).toEqual([
      ['body', -0.2, 0.2, 0, 1],
      ['detail', 0.85, 1.15, 0, 0.2],
      // The chord of a circle of radius 0.5 at 0.3 from its middle: ±0.4.
      ['post', 1.6, 2.4, 0, 1],
    ]);
  });
});

describe('the types rebuilt with the new shapes', () => {
  const shapesOf = (id: string, overrides: Record<string, unknown> = {}) => {
    const type = catalog.get(id)!;
    const { values } = effectiveParams(type, overrides);
    return pieces.get(id)!.parts(values, previewContext(type, values));
  };

  it('the microwave has a rounded body, the planter a lathed pot and plant, the shelf extruded hooks', () => {
    expect(shapesOf('appliance.microwave').filter((p) => p.shape === 'roundedBox')).toHaveLength(1);
    expect(shapesOf('garden.planter').map((p) => p.shape)).toEqual(['lathe', 'cylinder', 'lathe']);
    expect(shapesOf('garden.planter', { plantHeight: 0 }).map((p) => p.shape)).toEqual([
      'lathe',
      'cylinder',
    ]);
    expect(shapesOf('kitchen.wall-shelf').every((p) => p.shape === 'box')).toBe(true);
    const hooks = shapesOf('kitchen.wall-shelf', { rail: 'hooks' }).filter(
      (p) => p.shape === 'extrude',
    );
    expect(hooks).toHaveLength(18);
    // A hook hangs in front of the rail, below it, its side view across the wall.
    const rail = shapesOf('kitchen.wall-shelf', { rail: 'hooks' })[1]!;
    for (const hook of hooks) {
      expect(hook.rotationY).toBe(-Math.PI / 2);
      expect(hook.size.map((n) => +n.toFixed(6))).toEqual([0.022, 0.05, 0.005]);
      expect(hook.center[2] - 0.011).toBeCloseTo(rail.center[2] + rail.size[2] / 2);
      expect(hook.center[1] + 0.025).toBeLessThan(rail.center[1]);
    }
  });

  it('a square planter is the boxes it was', () => {
    expect(shapesOf('garden.planter', { shape: 'square' }).map((p) => p.shape)).toEqual([
      'box',
      'box',
      'cylinder',
      'cylinder',
    ]);
  });

  it('the planter stays within its diameter and ends at its pot and plant heights', () => {
    for (const overrides of [{}, { diameter: 1, height: 0.15, plantHeight: 1.2 }]) {
      const type = catalog.get('garden.planter')!;
      const { values } = effectiveParams(type, overrides);
      const { width, height } = furnitureSize(values);
      const { min, max } = boundsOf(shapesOf('garden.planter', overrides));
      expect(min[1]).toBeCloseTo(0);
      expect(max[1]).toBeCloseTo(height + Number(values.plantHeight));
      expect(max[0]).toBeCloseTo(width / 2);
      expect(min[0]).toBeCloseTo(-width / 2);
    }
  });

  it.each(['appliance.microwave', 'garden.planter', 'kitchen.wall-shelf'])(
    '%s: the size, the footprint and the dimensions come from its parameters, not its shapes',
    (id) => {
      const type = catalog.get(id)!;
      const values = defaultParams(type);
      const size = furnitureSize(values);
      const resolved = furniture.resolve(id)!;
      expect(resolved.size).toEqual(size);
      // The footprint is the rectangle or the ellipse of the size.
      const xs = resolved.footprint.map((p) => p[0]);
      const zs = resolved.footprint.map((p) => p[1]);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(size.width);
      expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(size.depth);
      const lines = pieces.get(id)!.dimensions(values, previewContext(type, values));
      expect(lines[0]!.value).toBe(size.width);
      // No part reaches out of the footprint's box.
      const { min, max } = boundsOf(resolved.parts);
      expect(min[0]).toBeGreaterThanOrEqual(-size.width / 2 - 1e-9);
      expect(max[0]).toBeLessThanOrEqual(size.width / 2 + 1e-9);
      expect(min[2]).toBeGreaterThanOrEqual(-size.depth / 2 - 1e-9);
      expect(max[2]).toBeLessThanOrEqual(size.depth / 2 + 0.005);
    },
  );
});

describe('triangles per type', () => {
  /** A type's triangles at its default size, as the viewer merges it. */
  const trianglesOf = (id: string) =>
    partBatches(previewParts(catalog.get(id)!)).reduce((n, m) => n + m.triangles, 0);

  it('every type of the catalogue is within the budget of a piece', () => {
    for (const type of catalog.types) {
      const count = trianglesOf(type.id);
      expect(count, type.id).toBeGreaterThan(0);
      expect(count, type.id).toBeLessThanOrEqual(BUDGETS.trianglesPerPiece);
    }
  });

  it('is recorded for every type', async () => {
    const counts = Object.fromEntries(catalog.types.map((t) => [t.id, trianglesOf(t.id)]));
    await expect(`${JSON.stringify(counts, null, 2)}\n`).toMatchFileSnapshot(
      './__golden__/triangles.json',
    );
  });
});
