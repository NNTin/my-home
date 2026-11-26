import {
  BoxGeometry,
  BufferAttribute,
  ExtrudeGeometry,
  Path,
  Shape,
  Vector2,
  Vector3,
  type BufferGeometry,
} from 'three';
import { describe, expect, it } from 'vitest';
import { capGeometry, clipGeometry, sectionLoops, type CutPlane } from './cut';

/** Keeps x >= 0.25: a section that looks along +x from the left. */
const PLANE: CutPlane = { normal: [1, 0, 0], constant: -0.25 };

function surface(geometry: BufferGeometry): number {
  const position = geometry.getAttribute('position');
  const index = geometry.index!;
  const [a, b, c] = [new Vector3(), new Vector3(), new Vector3()];
  let sum = 0;
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(position, index.getX(i));
    b.fromBufferAttribute(position, index.getX(i + 1));
    c.fromBufferAttribute(position, index.getX(i + 2));
    sum += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return sum;
}

/** The facing of each triangle, summed: where the surface looks on the whole. */
function facing(geometry: BufferGeometry): Vector3 {
  const position = geometry.getAttribute('position');
  const index = geometry.index!;
  const [a, b, c] = [new Vector3(), new Vector3(), new Vector3()];
  const sum = new Vector3();
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(position, index.getX(i));
    b.fromBufferAttribute(position, index.getX(i + 1));
    c.fromBufferAttribute(position, index.getX(i + 2));
    sum.add(b.sub(a).cross(c.sub(a)));
  }
  return sum;
}

/** A square tube along z: 2 m outside, 1 m inside, 1 m long. */
function tube(): BufferGeometry {
  const square = (half: number) =>
    [
      [-half, -half],
      [half, -half],
      [half, half],
      [-half, half],
    ].map(([x, y]) => new Vector2(x, y));
  const shape = new Shape(square(1));
  shape.holes = [new Path(square(0.5).reverse())];
  return new ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
}

describe('clipping a geometry by the cut', () => {
  it('returns the geometry itself when the plane does not touch it', () => {
    const box = new BoxGeometry(1, 1, 1).translate(2, 0, 0);
    expect(clipGeometry(box, PLANE)).toBe(box);
  });

  it('returns nothing for what lies wholly in front of the plane', () => {
    expect(clipGeometry(new BoxGeometry(1, 1, 1).translate(-2, 0, 0), PLANE)).toBeUndefined();
  });

  it('keeps the part behind the plane, open where it was cut', () => {
    // A cube of 1 m about the origin, cut at x = 0.25: a quarter of its length is kept.
    const clipped = clipGeometry(new BoxGeometry(1, 1, 1), PLANE)!;
    const position = clipped.getAttribute('position');
    for (let i = 0; i < position.count; i++)
      expect(position.getX(i)).toBeGreaterThanOrEqual(0.25 - 1e-6);
    // The face at +x and a quarter of the four faces around it; no face on the plane.
    expect(surface(clipped)).toBeCloseTo(1 + 4 * 0.25, 5);
  });

  it('carries every attribute along a cut edge', () => {
    const box = new BoxGeometry(1, 1, 1);
    const count = box.getAttribute('position').count;
    // A colour that is the vertex's own x: on the cut it must read 0.25.
    const color = new Float32Array(count * 4);
    for (let i = 0; i < count; i++)
      color.set([box.getAttribute('position').getX(i), 0, 0, 1], i * 4);
    box.setAttribute('color', new BufferAttribute(color, 4));
    const clipped = clipGeometry(box, PLANE)!;
    expect(Object.keys(clipped.attributes).sort()).toEqual(['color', 'normal', 'position', 'uv']);
    expect(clipped.getAttribute('color').itemSize).toBe(4);
    const position = clipped.getAttribute('position');
    let onCut = 0;
    for (let i = 0; i < position.count; i++) {
      expect(clipped.getAttribute('color').getX(i)).toBeCloseTo(position.getX(i), 5);
      expect(clipped.getAttribute('color').getW(i)).toBeCloseTo(1, 5);
      if (Math.abs(position.getX(i) - 0.25) < 1e-6) onCut += 1;
    }
    expect(onCut).toBeGreaterThan(0);
  });

  it('cuts a geometry without an index', () => {
    const clipped = clipGeometry(new BoxGeometry(1, 1, 1).toNonIndexed(), PLANE)!;
    expect(surface(clipped)).toBeCloseTo(2, 5);
  });
});

describe('the outline of a cut solid', () => {
  it('is one closed loop for a box', () => {
    const loops = sectionLoops(new BoxGeometry(1, 2, 3), PLANE);
    expect(loops).toHaveLength(1);
    for (const [x] of loops[0]!) expect(x).toBeCloseTo(0.25, 6);
    const ys = loops[0]!.map((p) => p[1]);
    const zs = loops[0]!.map((p) => p[2]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([-1, 1]);
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([-1.5, 1.5]);
  });

  it('is nothing for a solid the plane does not go through', () => {
    expect(sectionLoops(new BoxGeometry(1, 1, 1).translate(3, 0, 0), PLANE)).toEqual([]);
  });

  it('is two loops for a tube cut across: its outside and its hollow', () => {
    // Cut across the tube's length: the plane z = 0.5, looking along +z.
    const loops = sectionLoops(tube(), { normal: [0, 0, 1], constant: -0.5 });
    expect(loops).toHaveLength(2);
  });
});

describe('the cap of a cut solid', () => {
  it('fills the outline of a box and faces the side that was cut away', () => {
    const box = new BoxGeometry(1, 2, 3);
    const cap = capGeometry([sectionLoops(box, PLANE)], PLANE, [0.1, 0.2, 0.3])!;
    expect(surface(cap)).toBeCloseTo(2 * 3, 5);
    const towards = facing(cap).normalize();
    expect(towards.x).toBeCloseTo(-1, 5);
    const normal = cap.getAttribute('normal');
    expect(normal.getX(0)).toBe(-1);
    expect(Math.abs(normal.getY(0)) + Math.abs(normal.getZ(0))).toBe(0);
    const color = cap.getAttribute('color');
    expect(color.getX(0)).toBeCloseTo(0.1, 6);
    expect(color.getZ(0)).toBeCloseTo(0.3, 6);
  });

  it('lies in front of the plane by its lift', () => {
    const cap = capGeometry(
      [sectionLoops(new BoxGeometry(1, 1, 1), PLANE)],
      PLANE,
      [1, 1, 1],
      0.002,
    )!;
    expect(cap.getAttribute('position').getX(0)).toBeCloseTo(0.248, 6);
  });

  it('has texture coordinates in metres on the plane', () => {
    const cap = capGeometry([sectionLoops(new BoxGeometry(1, 2, 3), PLANE)], PLANE, [1, 1, 1])!;
    const uv = cap.getAttribute('uv');
    const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i));
    const vs = Array.from({ length: uv.count }, (_, i) => uv.getY(i));
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(3, 5);
    expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(2, 5);
  });

  it('leaves the hollow of a tube open', () => {
    const plane: CutPlane = { normal: [0, 0, 1], constant: -0.5 };
    const cap = capGeometry([sectionLoops(tube(), plane)], plane, [1, 1, 1])!;
    // 2 x 2 m less the hollow of 1 x 1 m.
    expect(surface(cap)).toBeCloseTo(3, 5);
    expect(facing(cap).normalize().z).toBeCloseTo(-1, 5);
  });

  it('caps two solids each for itself', () => {
    const solids = [
      sectionLoops(new BoxGeometry(1, 1, 1), PLANE),
      sectionLoops(new BoxGeometry(1, 1, 1).translate(0, 0, 5), PLANE),
    ];
    expect(surface(capGeometry(solids, PLANE, [1, 1, 1])!)).toBeCloseTo(2, 5);
  });

  it('caps a solid that stands in another one too', () => {
    // A small box inside a large one: two caps, one over the other, not a hole in the large one.
    const solids = [
      sectionLoops(new BoxGeometry(1, 4, 4), PLANE),
      sectionLoops(new BoxGeometry(1, 1, 1), PLANE),
    ];
    expect(surface(capGeometry(solids, PLANE, [1, 1, 1])!)).toBeCloseTo(16 + 1, 5);
  });

  it('is nothing without an outline', () => {
    expect(capGeometry([], PLANE, [1, 1, 1])).toBeUndefined();
  });
});
