import { HomeModel } from '@my-home/shared';
import { Box3, Matrix4, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import mockHomeJson from '../../../../packages/shared/test-fixtures/mock-home.json';
import { buildHome } from '../builder/buildHome';
import { batchKey, linearRgb, shellItems, type DrawItem } from '../builder/drawList';
import { furniture } from '../catalog/furniture';
import { partBatches } from './PartsMesh';
import { box } from '../catalog/parts';
import { batches, batchMaterial, shapeGeometry } from './batches';

const scene = buildHome(HomeModel.parse(structuredClone(mockHomeJson)));
const items = shellItems(scene);
const merged = batches(items);

const vertices = (g: BufferGeometry) => g.getAttribute('position').count;
const triangles = (g: BufferGeometry) => (g.index ? g.index.count : vertices(g)) / 3;

/** What the item alone would draw: its geometry in the world. */
function alone(item: DrawItem) {
  const g = shapeGeometry(item.shape);
  g.applyMatrix4(new Matrix4().fromArray(item.matrix));
  return g;
}

describe('batches', () => {
  it('merges the items with the same key, and only those', () => {
    const keys = new Set(items.map(batchKey));
    expect(merged.map((b) => b.key)).toEqual([...keys]);
    expect(merged.length).toBeLessThan(items.length / 3);
    expect(merged.reduce((n, b) => n + b.items, 0)).toBe(items.length);
  });

  it('conserves vertices, triangles and bounds', () => {
    for (const batch of merged) {
      const own = items.filter((i) => batchKey(i) === batch.key).map(alone);
      expect(vertices(batch.geometry)).toBe(own.reduce((n, g) => n + vertices(g), 0));
      expect(batch.triangles).toBe(own.reduce((n, g) => n + triangles(g), 0));
      expect(triangles(batch.geometry)).toBe(batch.triangles);
      const bounds = new Box3();
      for (const g of own) {
        g.computeBoundingBox();
        bounds.union(g.boundingBox!);
      }
      batch.geometry.computeBoundingBox();
      const got = batch.geometry.boundingBox!;
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(got.min[axis]).toBeCloseTo(bounds.min[axis], 5);
        expect(got.max[axis]).toBeCloseTo(bounds.max[axis], 5);
      }
    }
  });

  it('writes each item’s tint into its vertices, in linear light', () => {
    const batch = merged.find((b) => b.items > 1)!;
    const own = items.filter((i) => batchKey(i) === batch.key);
    const color = batch.geometry.getAttribute('color');
    let at = 0;
    for (const item of own) {
      const count = vertices(alone(item));
      const [r, g, b] = linearRgb(item.tint);
      for (const i of [at, at + count - 1]) {
        expect(color.getX(i)).toBeCloseTo(r, 6);
        expect(color.getY(i)).toBeCloseTo(g, 6);
        expect(color.getZ(i)).toBeCloseTo(b, 6);
      }
      at += count;
    }
    expect(at).toBe(color.count);
  });

  it('keeps every index inside the batch', () => {
    for (const batch of merged) {
      const index = batch.geometry.index!;
      let max = 0;
      for (let i = 0; i < index.count; i++) max = Math.max(max, index.getX(i));
      expect(max).toBe(vertices(batch.geometry) - 1);
    }
  });

  it('a batch belongs to one group, so hiding a level hides whole batches', () => {
    for (const batch of merged) {
      const own = items.filter((i) => batchKey(i) === batch.key);
      expect(new Set(own.map((i) => JSON.stringify(i.group))).size).toBe(1);
      expect(batch.group).toEqual(own[0]!.group);
    }
  });
});

describe('the meshes of a piece', () => {
  const glass = { transparent: true, opacity: 0.35, depthWrite: false };

  it('are one opaque mesh and one transparent mesh, whatever the colours', () => {
    const meshes = partBatches([
      box([0, 0, 0], [1, 1, 1], '#aa0000', 'frame'),
      box([0, 0, 0.2], [1, 1, 0.01], '#88aacc', 'glass', glass),
      box([0, 1, 0], [1, 1, 1], '#00aa00', 'sash'),
      box([0, 0, -0.2], [1, 1, 0.01], '#aaccee', 'glass', { ...glass, opacity: 0.6 }),
    ]);
    expect(meshes.map((m) => [m.items, m.material?.transparent ?? false])).toEqual([
      [2, false],
      [2, true],
    ]);
    // The opacity of each pane is in its vertices.
    const alpha = meshes[1]!.geometry.getAttribute('color');
    expect(alpha.itemSize).toBe(4);
    expect(alpha.getW(0)).toBeCloseTo(0.35, 6);
    expect(alpha.getW(alpha.count - 1)).toBeCloseTo(0.6, 6);
    expect(meshes[0]!.geometry.getAttribute('color').itemSize).toBe(3);
  });

  it('every catalogue type is at most four meshes at its default size', () => {
    const counts = furniture.categories
      .flatMap((c) => c.types)
      .map((t) => partBatches(furniture.resolve(t.id)!.parts).length);
    expect(Math.max(...counts)).toBeLessThanOrEqual(4);
    // Most are one opaque mesh, or one opaque and one transparent.
    expect(counts.filter((n) => n <= 2).length).toBeGreaterThan(counts.length * 0.8);
  });
});

describe('batchMaterial', () => {
  it('is shared by every batch of the same kind of surface', () => {
    expect(batchMaterial(undefined)).toBe(batchMaterial({}));
    expect(batchMaterial({ transparent: true, opacity: 0.3 })).toBe(
      batchMaterial({ transparent: true, opacity: 0.6 }),
    );
    expect(batchMaterial({ doubleSided: true })).not.toBe(batchMaterial(undefined));
    expect(batchMaterial(undefined).vertexColors).toBe(true);
  });

  it('a glowing mesh draws with a copy, never with the shared material', () => {
    const plain = batchMaterial(undefined);
    const glowing = batchMaterial(undefined, { color: '#3d8bff', intensity: 0.4 });
    expect(glowing).not.toBe(plain);
    expect(glowing.emissiveIntensity).toBe(0.4);
    expect(plain.emissive.getHex()).toBe(0);
  });
});

describe('a flat polygon', () => {
  /** A wall face of 4 m by 2.5 m at z = 0.12 with a window in it, seen from +z. */
  const outline: [number, number, number][] = [
    [0, 0, 0.12],
    [4, 0, 0.12],
    [4, 2.5, 0.12],
    [0, 2.5, 0.12],
  ];
  const hole: [number, number, number][] = [
    [1, 0.9, 0.12],
    [1, 2.1, 0.12],
    [2, 2.1, 0.12],
    [2, 0.9, 0.12],
  ];
  const area = (g: BufferGeometry) => {
    const p = g.getAttribute('position');
    let sum = 0;
    for (let i = 0; i < g.index!.count; i += 3) {
      const [a, b, c] = [g.index!.getX(i), g.index!.getX(i + 1), g.index!.getX(i + 2)];
      // Twice the signed area in (x, y): positive when the triangle is anticlockwise from +z.
      sum +=
        (p.getX(b) - p.getX(a)) * (p.getY(c) - p.getY(a)) -
        (p.getX(c) - p.getX(a)) * (p.getY(b) - p.getY(a));
    }
    return sum / 2;
  };

  it('is its corners and nothing else: one vertex each, shared by its triangles', () => {
    const g = shapeGeometry({ kind: 'polygon', outline, holes: [hole] });
    expect(vertices(g)).toBe(8);
    expect(triangles(g)).toBe(8);
    expect(area(g)).toBeCloseTo(4 * 2.5 - 1.2, 6);
    const normal = g.getAttribute('normal');
    for (let i = 0; i < normal.count; i++)
      expect([normal.getX(i), normal.getY(i), normal.getZ(i)]).toEqual([0, 0, 1]);
  });

  it('faces the side its outline is anticlockwise from, every triangle of it', () => {
    const back = shapeGeometry({ kind: 'polygon', outline: [...outline].reverse(), holes: [] });
    expect(back.getAttribute('normal').getZ(0)).toBe(-1);
    expect(area(back)).toBeCloseTo(-10, 6);
    // Lying down, facing up: a wall's top.
    const top = shapeGeometry({
      kind: 'polygon',
      outline: [
        [0, 2.5, 0.12],
        [4, 2.5, 0.12],
        [4, 2.5, -0.12],
        [0, 2.5, -0.12],
      ],
      holes: [],
    });
    expect(top.getAttribute('normal').getY(0)).toBe(1);
    expect(triangles(top)).toBe(2);
  });

  it('merges with the other items of its batch', () => {
    const faces = items.filter((i) => i.shape.kind === 'polygon');
    expect(faces.length).toBeGreaterThan(100);
    const [batch] = batches(faces.filter((i) => batchKey(i) === batchKey(faces[0]!)));
    expect(batch!.items).toBeGreaterThan(5);
    expect(batch!.geometry.getAttribute('color').count).toBe(vertices(batch!.geometry));
  });
});
