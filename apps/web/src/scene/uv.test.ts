import { finishes, HomeModel, withoutFinishes } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import realHomeJson from '../../../../data/homes/home.json';
import { buildHome } from '../builder/buildHome';
import { batchKey, shellItems, type DrawItem } from '../builder/drawList';
import { batches, finishHasTexture, shapeGeometry } from './batches';

// Texture coordinates in metres, written at merge time (docs/design/realistic-render.md §5.4).

const TILE = finishes.get('tile.light-60')!;
/** One repeat of the texture is four tiles each way (the finish's definition). */
const TILES_PER_REPEAT = 4;

/** The real home with its own finishes taken out: these tests choose theirs. */
const model = () => withoutFinishes(HomeModel.parse(structuredClone(realHomeJson)));
const chosen = (finish: string, rest: Record<string, unknown> = {}) => ({
  finish,
  source: 'mock' as const,
  ...rest,
});

function tiled() {
  const m = model();
  m.rooms.find((r) => r.id === 'souterrain-kitchen')!.finishes = {
    floor: chosen('tile.light-60'),
    walls: chosen('tile.light-60'),
  };
  return buildHome(m);
}

/** The merged geometry of one item alone, with its positions and texture coordinates. */
function drawn(item: DrawItem) {
  const [batch] = batches([item]);
  const position = batch!.geometry.getAttribute('position');
  const uv = batch!.geometry.getAttribute('uv');
  return Array.from({ length: position.count }, (_, i) => ({
    p: [position.getX(i), position.getY(i), position.getZ(i)] as const,
    uv: [uv.getX(i), uv.getY(i)] as const,
  }));
}

const span = (values: number[]) => Math.max(...values) - Math.min(...values);

describe('a tile of 60 cm measures 60 cm', () => {
  const scene = tiled();
  const items = shellItems(scene);

  it('one repeat covers 2.4 m: four tiles of 60 cm', () => {
    expect(TILE.tileSize! / TILES_PER_REPEAT).toBeCloseTo(0.6, 12);
  });

  it('on a floor: a metre of floor is a metre of texture, along both plan axes', () => {
    const floor = items.find((i) => i.id === 'souterrain-kitchen:floor')!;
    const vertices = drawn(floor);
    // In metres: a coordinate is the plan position, so the difference is the distance.
    for (const { p, uv } of vertices) {
      expect(uv[0]).toBeCloseTo(p[0], 5);
      expect(uv[1]).toBeCloseTo(p[2], 5);
    }
    const width = span(vertices.map((v) => v.p[0]));
    const tilesAcross = (span(vertices.map((v) => v.uv[0])) / TILE.tileSize!) * TILES_PER_REPEAT;
    expect(width / tilesAcross).toBeCloseTo(0.6, 9);
    expect(width).toBeGreaterThan(2);
  });

  it('on a wall: along the wall and up, from the wall’s start at its floor', () => {
    const wall = scene.walls.find((w) => w.faces.some((f) => f.roomId === 'souterrain-kitchen'))!;
    const index = wall.faces.findIndex((f) => f.roomId === 'souterrain-kitchen');
    const face = items.find((i) => i.id === `${wall.id}/face-${index}`)!;
    expect(face.finish).toBe('tile.light-60');
    const vertices = drawn(face);
    expect(vertices).toHaveLength(6);
    const [ox, oy, oz] = wall.uv.origin;
    /** How far along the wall a point is, from the wall's start. */
    const along = (p: readonly [number, number, number]) =>
      (p[0] - ox) * wall.uv.u[0] + (p[2] - oz) * wall.uv.u[2];
    for (const { p, uv } of vertices) {
      // `u` is the distance along the wall from its start, `v` the height above its floor.
      expect(uv[0]).toBeCloseTo(along(p), 5);
      expect(uv[1]).toBeCloseTo(p[1] - oy, 5);
    }
    const height = span(vertices.map((v) => v.p[1]));
    const length = span(vertices.map((v) => along(v.p)));
    expect(length).toBeCloseTo(face.shape.kind === 'box' ? face.shape.size[0] : NaN, 5);
    expect(span(vertices.map((v) => v.uv[1]))).toBeCloseTo(height, 5);
    expect(span(vertices.map((v) => v.uv[0]))).toBeCloseTo(length, 5);
    const tilesUp = (span(vertices.map((v) => v.uv[1])) / TILE.tileSize!) * TILES_PER_REPEAT;
    expect(height / tilesUp).toBeCloseTo(0.6, 6);
  });

  it('both faces of a wall count from the same start, so they line up', () => {
    const wall = scene.walls.find(
      (w) => w.faces.some((f) => f.side === 1) && w.faces.some((f) => f.side === -1),
    )!;
    const frames = items.filter((i) => i.id.startsWith(`${wall.id}/face-`)).map((i) => i.uv);
    expect(new Set(frames.map((f) => JSON.stringify(f))).size).toBe(1);
  });
});

describe('texture coordinates', () => {
  const scene = buildHome(model());
  const items = shellItems(scene);

  it('are written for the batches of textured finishes only', () => {
    const merged = batches(items);
    expect(merged.some((b) => finishHasTexture(b.finish))).toBe(true);
    for (const batch of merged) {
      expect(batch.geometry.hasAttribute('uv'), batch.key).toBe(finishHasTexture(batch.finish));
      if (!batch.geometry.hasAttribute('uv')) continue;
      expect(batch.geometry.getAttribute('uv').count).toBe(
        batch.geometry.getAttribute('position').count,
      );
    }
    expect(finishHasTexture('paint.plain')).toBe(false);
    expect(finishHasTexture('part')).toBe(false);
  });

  it('lie on the plan for the ground, from the plan origin, so neighbours line up', () => {
    const lawns = items.filter((i) => i.finish === 'grass.lawn' && i.shape.kind === 'surface');
    expect(lawns.length).toBeGreaterThan(1);
    for (const lawn of lawns) {
      for (const { p, uv } of drawn(lawn)) {
        expect(uv[0]).toBeCloseTo(p[0], 5);
        expect(uv[1]).toBeCloseTo(p[2], 5);
      }
    }
  });

  it('run along the eave and up the slope of a roof plane, at true length', () => {
    for (const plane of scene.roofPlanes) {
      const item = items.find((i) => i.id === plane.id)!;
      expect(item.uv).toEqual(plane.uv);
      const { u, v } = plane.uv;
      expect(Math.hypot(...u)).toBeCloseTo(1, 9);
      expect(Math.hypot(...v)).toBeCloseTo(1, 9);
      expect(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]).toBeCloseTo(0, 9);
      // Up the slope: it rises, and it is not vertical.
      expect(v[1]).toBeGreaterThan(0.1);
      expect(v[1]).toBeLessThan(0.99);
      const vertices = drawn(item);
      // The top face reaches from the eave (v = 0) up to the ridge: the true length of the slope.
      const [a, b] = [plane.outline[2]!, plane.outline[3]!];
      const slope = Math.hypot(a[0] - b[0], a[1] - b[1]);
      expect(Math.max(...vertices.map((x) => x.uv[1]))).toBeCloseTo(slope, 5);
      expect(Math.max(...vertices.map((x) => x.uv[0]))).toBeCloseTo(plane.depth, 5);
      // The eave starts at 0. (The verges and the eave edge are projected along the frame's
      // third axis, so their coordinates are not part of this run.)
      expect(vertices.some((x) => Math.abs(x.uv[0]) < 1e-5 && Math.abs(x.uv[1]) < 1e-5)).toBe(true);
    }
  });

  it('do not smear on the faces of a wall that are at right angles to its frame', () => {
    // The parapet under a window of an exterior wall: its top is the sill of the reveal, its
    // ends are inside the wall. The core of a wall segment is everything but its two long faces.
    const walls = scene.walls.filter((w) => w.kind === 'exterior' && !w.outline);
    const below = walls.find((w) => w.id.endsWith(':below'))!;
    const full = walls.find((w) => w.id.endsWith(':full'))!;
    for (const wall of [below, full]) {
      const core = items.find((i) => i.id === wall.id)!;
      expect(core.finish).toBe('render.facade');
      const [length, height, thickness] = wall.size;
      // The top of a full-height segment is a cut face, an item of its own (§7.2): the same
      // faces either way.
      const whole = { ...core, shape: { ...core.shape, only: 'core' } } as DrawItem;
      const vertices = drawn(whole);
      // Six vertices a face, in the order of the box's faces without the two long ones:
      // the two ends, then the top and the bottom.
      const face = (n: number) => vertices.slice(n * 6, n * 6 + 6);
      for (const end of [face(0), face(1)]) {
        // An end (and so the jamb of a reveal): the wall's thickness across, its height up.
        expect(span(end.map((x) => x.uv[0]))).toBeCloseTo(thickness, 5);
        expect(span(end.map((x) => x.uv[1]))).toBeCloseTo(height, 5);
      }
      for (const flat of [face(2), face(3)]) {
        // A top (and so the sill of a reveal): the length along, the thickness across.
        expect(span(flat.map((x) => x.uv[0]))).toBeCloseTo(length, 5);
        expect(span(flat.map((x) => x.uv[1]))).toBeCloseTo(thickness, 5);
      }
    }
  });

  it('do not smear on the edges of a roof plane', () => {
    for (const plane of scene.roofPlanes) {
      const vertices = drawn(items.find((i) => i.id === plane.id)!);
      const { u, v } = plane.uv;
      const w = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      // Every triangle covers an area in texture space in proportion to its own: none is a line.
      for (let i = 0; i < vertices.length; i += 3) {
        const [a, b, c] = [vertices[i]!, vertices[i + 1]!, vertices[i + 2]!];
        const e1 = [b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]];
        const e2 = [c.p[0] - a.p[0], c.p[1] - a.p[1], c.p[2] - a.p[2]];
        const cross = [
          e1[1]! * e2[2]! - e1[2]! * e2[1]!,
          e1[2]! * e2[0]! - e1[0]! * e2[2]!,
          e1[0]! * e2[1]! - e1[1]! * e2[0]!,
        ];
        const area = Math.hypot(...cross) / 2;
        const uvArea =
          Math.abs(
            (b.uv[0] - a.uv[0]) * (c.uv[1] - a.uv[1]) - (c.uv[0] - a.uv[0]) * (b.uv[1] - a.uv[1]),
          ) / 2;
        // In metres, and at most turned by the angle between the face and an axis of the frame.
        expect(uvArea / area, `triangle ${i / 3}`).toBeGreaterThan(0.5);
        expect(uvArea / area, `triangle ${i / 3}`).toBeLessThan(1.0001);
      }
      expect(Math.hypot(...w)).toBeCloseTo(1, 9);
    }
  });

  it('are a box projection in the item’s own frame for a box without a frame', () => {
    const tread = items.find((i) => i.finish === 'wood.oak-laminate' && i.shape.kind === 'box')!;
    expect(tread.uv).toBeUndefined();
    const size = (tread.shape as { size: [number, number, number] }).size;
    const us = drawn(tread).map((x) => x.uv[0]);
    const vs = drawn(tread).map((x) => x.uv[1]);
    // Centred on the box: no coordinate is further out than half its largest side.
    const half = Math.max(...size) / 2;
    expect(Math.max(...us.map(Math.abs), ...vs.map(Math.abs))).toBeCloseTo(half, 5);
  });
});

describe('the parts of a wall', () => {
  const scene = buildHome(model());
  const items = shellItems(scene);
  const triangles = (item: DrawItem) => {
    const g = shapeGeometry(item.shape);
    return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  };

  it('core, front and back together have the triangles of the whole box or profile', () => {
    for (const wall of scene.walls) {
      const own = items.filter((i) => i.id === wall.id || i.id.startsWith(`${wall.id}/face-`));
      // The core, whether it is one item or its top and the rest (a cut face, §7.2).
      const core = { ...own[0]!, shape: { ...own[0]!.shape, only: 'core' } } as DrawItem;
      const whole = { ...core, shape: { ...core.shape, only: undefined } } as DrawItem;
      const faces = own.slice(1);
      if (wall.outline) {
        // The caps of a profile are triangulated per stretch; its sides are the core's.
        expect(triangles(core)).toBe(triangles(whole) - 2 * (wall.outline.length - 2));
      } else {
        expect(triangles(core)).toBe(8);
        expect(faces.every((f) => triangles(f) === 2)).toBe(true);
        expect(triangles(whole)).toBe(12);
      }
    }
  });

  it('a face is flat and looks along the segment’s local z', () => {
    const wall = scene.walls.find((w) => !w.outline)!;
    const faces = items.filter((i) => i.id.startsWith(`${wall.id}/face-`));
    for (const face of faces) {
      const g = shapeGeometry(face.shape);
      const normal = g.getAttribute('normal');
      const want = (face.shape as { only: string }).only === 'front' ? 1 : -1;
      for (let i = 0; i < normal.count; i++) expect(normal.getZ(i)).toBe(want);
    }
  });

  it('faces of one finish on one level share a batch, whatever room they border', () => {
    const faces = items.filter((i) => i.id.includes('/face-') && i.finish === 'paint.plain');
    const keys = new Set(faces.map(batchKey));
    expect(faces.length).toBeGreaterThan(50);
    expect(keys.size).toBeLessThanOrEqual(2);
  });
});
