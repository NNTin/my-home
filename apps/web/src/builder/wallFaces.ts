import type { ResolvedFinish } from '@my-home/shared';
import { pointInPolygon } from '../editor/geometry';
import type { UvFrame, Vec2, Vec3 } from './buildHome';
import { EPS } from './plan';

/**
 * The faces of a wall (docs/design/realistic-render.md §8.1). A wall is drawn face by face, not
 * box by box: each long face is one polygon per room it borders, with its openings as holes, so
 * no edge of one triangle ends in the middle of another's and nothing shows through as a seam.
 * All the faces of a wall are in one frame: x along the wall from its start, y up from its floor,
 * z across it (the face at +z is the `front`). Pure geometry, no three.js.
 */

/**
 * Which face of the wall: a long face, its top, an end, the reveal of an opening. The underside
 * is never drawn: a wall stands on the slab of its level, which is shown and hidden with it.
 */
export type WallFacePart = 'front' | 'back' | 'top' | 'end' | 'reveal';

/** A flat polygon of a wall, anticlockwise seen from the side it faces. */
export interface WallFaceShape {
  /** After the wall's id. */
  id: string;
  part: WallFacePart;
  /** The room the face borders. */
  roomId?: string;
  /** For a reveal: the opening it lines. */
  openingId?: string;
  finish: ResolvedFinish;
  outline: Vec3[];
  holes: Vec3[][];
}

/** A hole through the wall: an opening, along the wall and above its floor. */
export interface WallCut {
  id: string;
  from: number;
  to: number;
  bottom: number;
  top: number;
}

/** A stretch of a long face that borders one room (or none). */
export interface FaceRun {
  from: number;
  to: number;
  roomId?: string;
  finish: ResolvedFinish;
}

/**
 * What an end face of the wall borders: a room's finish, or nothing (the wall's own finish). An
 * end that stands in the body of another wall is `covered` and not drawn: where two walls go on
 * in one line it would lie edge-on in their common face and show there as a hairline.
 */
export interface WallEnd {
  covered?: boolean;
  roomId?: string;
  finish?: ResolvedFinish;
}

export interface WallFacesInput {
  length: number;
  height: number;
  thickness: number;
  cuts: readonly WallCut[];
  /** The wall's top edge, from its start to its end: flat, or under a pitched roof. */
  chain: readonly Vec2[];
  runs: Record<1 | -1, readonly FaceRun[]>;
  ends: [WallEnd, WallEnd];
  /** The finish of an end that borders no room. */
  finish: ResolvedFinish;
  /** The finish of the top: a cut face. */
  cutFinish: ResolvedFinish;
}

const sorted = (values: number[]) =>
  values.sort((a, b) => a - b).filter((v, i, all) => i === 0 || v - all[i - 1]! > EPS);

/** Twice the area of a polygon: positive when anticlockwise. */
const area2 = (p: readonly Vec2[]) =>
  p.reduce((sum, [x, y], i) => {
    const [nx, ny] = p[(i + 1) % p.length]!;
    return sum + x * ny - nx * y;
  }, 0);

/** Drops repeated and collinear vertices of a closed polygon. */
export function simplify(points: Vec2[]): Vec2[] {
  let result = points;
  for (let changed = true; changed && result.length > 3;) {
    changed = false;
    for (let i = 0; i < result.length; i++) {
      const [ax, ay] = result[(i + result.length - 1) % result.length]!;
      const [bx, by] = result[i]!;
      const [cx, cy] = result[(i + 1) % result.length]!;
      if (Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) < EPS * EPS) {
        result = result.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return result;
}

/**
 * The rectangle `from`..`to` by 0..`height` without the cuts, as polygons: an outline
 * (anticlockwise) with its holes (clockwise). A cut that touches the rectangle's edge (a door
 * at the floor) is a notch in the outline, and a cut from floor to top leaves two polygons.
 */
export function faceRegions(
  from: number,
  to: number,
  height: number,
  cuts: readonly WallCut[],
): { outline: Vec2[]; holes: Vec2[][] }[] {
  const within = cuts
    .map((c) => ({
      from: Math.max(c.from, from),
      to: Math.min(c.to, to),
      bottom: Math.max(c.bottom, 0),
      top: Math.min(c.top, height),
    }))
    .filter((c) => c.to - c.from > EPS && c.top - c.bottom > EPS);
  if (within.length === 0) {
    return [
      {
        outline: [
          [from, 0],
          [to, 0],
          [to, height],
          [from, height],
        ],
        holes: [],
      },
    ];
  }
  // A grid through every edge; a cell is wall or hole. The boundary of the wall cells, walked
  // with the wall on the left, is the outlines (anticlockwise) and the holes (clockwise).
  const xs = sorted([from, to, ...within.flatMap((c) => [c.from, c.to])]);
  const ys = sorted([0, height, ...within.flatMap((c) => [c.bottom, c.top])]);
  const solid = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= xs.length - 1 || j >= ys.length - 1) return false;
    const x = (xs[i]! + xs[i + 1]!) / 2;
    const y = (ys[j]! + ys[j + 1]!) / 2;
    return !within.some((c) => x > c.from && x < c.to && y > c.bottom && y < c.top);
  };
  const key = (i: number, j: number) => i * ys.length + j;
  const next = new Map<number, number[]>();
  const edge = (a: number, b: number) => next.set(a, [...(next.get(a) ?? []), b]);
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      if (!solid(i, j)) continue;
      if (!solid(i, j - 1)) edge(key(i, j), key(i + 1, j));
      if (!solid(i + 1, j)) edge(key(i + 1, j), key(i + 1, j + 1));
      if (!solid(i, j + 1)) edge(key(i + 1, j + 1), key(i, j + 1));
      if (!solid(i - 1, j)) edge(key(i, j + 1), key(i, j));
    }
  }
  const loops: Vec2[][] = [];
  for (const start of next.keys()) {
    while (next.get(start)?.length) {
      const loop: Vec2[] = [];
      let at = start;
      do {
        loop.push([xs[Math.floor(at / ys.length)]!, ys[at % ys.length]!]);
        at = next.get(at)!.pop()!;
      } while (at !== start);
      loops.push(simplify(loop));
    }
  }
  const regions = loops
    .filter((l) => area2(l) > 0)
    .map((outline) => ({ outline, holes: [] as Vec2[][] }));
  for (const hole of loops.filter((l) => area2(l) < 0)) {
    // A point just inside the hole's first corner is inside the outline that holds it.
    const [[ax, ay], [bx, by], [cx, cy]] = [hole[0]!, hole[1]!, hole.at(-1)!];
    const inside: Vec2 = [ax + (bx - ax + cx - ax) * 1e-3, ay + (by - ay + cy - ay) * 1e-3];
    (regions.find((r) => pointInPolygon(inside, r.outline)) ?? regions[0])?.holes.push(hole);
  }
  return regions;
}

/** The part of a polygon on or below the line through `a` and `b` (Sutherland-Hodgman). */
function below(points: Vec2[], [ax, ay]: Vec2, [bx, by]: Vec2): Vec2[] {
  const over = ([x, y]: Vec2) => y - (ay + ((by - ay) * (x - ax)) / (bx - ax));
  const out: Vec2[] = [];
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length]!;
    const [dp, dq] = [over(p), over(q)];
    if (dp <= EPS) out.push(p);
    if ((dp > EPS && dq < -EPS) || (dp < -EPS && dq > EPS)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  });
  return out;
}

/**
 * A polygon trimmed to the wall's top edge. The edge under a pitched roof never bends upwards,
 * so what lies below it is what lies below the line of each of its stretches.
 */
function trimmed(points: Vec2[], chain: readonly Vec2[]): Vec2[] {
  let result = points;
  for (let i = 0; i + 1 < chain.length && result.length >= 3; i++) {
    if (chain[i + 1]![0] - chain[i]![0] > EPS) result = below(result, chain[i]!, chain[i + 1]!);
  }
  return result.length >= 3 ? simplify(result) : [];
}

/** The height of the wall's top edge at `x`. */
function chainAt(chain: readonly Vec2[], x: number): number {
  for (let i = 0; i + 1 < chain.length; i++) {
    const [[x0, y0], [x1, y1]] = [chain[i]!, chain[i + 1]!];
    if (x <= x1 + EPS) return x1 - x0 < EPS ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return chain.at(-1)![1];
}

const runAt = (runs: readonly FaceRun[], x: number) =>
  runs.find((r) => x >= r.from && x <= r.to) ?? runs[0];

/** The faces of one wall, in its frame. */
export function wallFaceShapes(wall: WallFacesInput): WallFaceShape[] {
  const { length, height, thickness, chain, runs } = wall;
  const half = thickness / 2;
  const flat = chain.every(([, y]) => y >= height - EPS);
  const cuts = wall.cuts
    .map((c) => ({
      ...c,
      from: Math.max(c.from, 0),
      to: Math.min(c.to, length),
      bottom: Math.max(c.bottom, 0),
      top: Math.min(c.top, height),
    }))
    .filter((c) => c.to - c.from > EPS && c.top - c.bottom > EPS);
  const faces: WallFaceShape[] = [];
  const room = (r: { roomId?: string }) => (r.roomId !== undefined ? { roomId: r.roomId } : {});

  // The two long faces: one polygon per room the face borders, the openings as holes.
  for (const side of [1, -1] as const) {
    const lift = (loop: Vec2[]): Vec3[] => {
      const points = loop.map(([x, y]): Vec3 => [x, y, side * half]);
      return side > 0 ? points : points.reverse();
    };
    let n = 0;
    for (const run of runs[side]) {
      for (const region of faceRegions(run.from, run.to, height, cuts)) {
        const outline = flat ? region.outline : trimmed(region.outline, chain);
        if (outline.length < 3) continue;
        const holes = region.holes
          .map((h) => (flat ? h : trimmed(h, chain)))
          .filter((h) => h.length >= 3);
        faces.push({
          id: `${side > 0 ? 'front' : 'back'}-${n++}`,
          part: side > 0 ? 'front' : 'back',
          ...room(run),
          finish: run.finish,
          outline: lift(outline),
          holes: holes.map(lift),
        });
      }
    }
  }

  // The top, a cut face (§7.2): one polygon per stretch of the top edge, with a vertex wherever
  // a long face has one, and none where an opening reaches the top.
  const open = cuts.filter((c) => c.top >= height - EPS);
  const stops = (side: 1 | -1, from: number, to: number) =>
    runs[side].map((r) => r.from).filter((x) => x > from + EPS && x < to - EPS);
  let tops = 0;
  for (let i = 0; i + 1 < chain.length; i++) {
    const [[x0, y0], [x1, y1]] = [chain[i]!, chain[i + 1]!];
    if (x1 - x0 < EPS || Math.max(y0, y1) < EPS) continue;
    const edges = sorted([x0, x1, ...open.flatMap((c) => [c.from, c.to])]).filter(
      (x) => x >= x0 - EPS && x <= x1 + EPS,
    );
    for (let k = 0; k + 1 < edges.length; k++) {
      const [from, to] = [edges[k]!, edges[k + 1]!];
      const mid = (from + to) / 2;
      if (open.some((c) => mid > c.from && mid < c.to)) continue;
      const y = (x: number) => Math.max(0, x === x0 ? y0 : x === x1 ? y1 : chainAt(chain, x));
      faces.push({
        id: `top-${tops++}`,
        part: 'top',
        finish: wall.cutFinish,
        outline: [
          ...[from, ...stops(1, from, to), to].map((x): Vec3 => [x, y(x), half]),
          ...[to, ...stops(-1, from, to).reverse(), from].map((x): Vec3 => [x, y(x), -half]),
        ],
        holes: [],
      });
    }
  }

  // The two ends, where no opening stands in them.
  ([0, 1] as const).forEach((which) => {
    const x = which === 0 ? 0 : length;
    const top = Math.min(height, chainAt(chain, x));
    const end = wall.ends[which];
    if (end.covered || top < EPS) return;
    if (cuts.some((c) => (which === 0 ? c.from < EPS : c.to > length - EPS))) return;
    const outline: Vec3[] = [
      [x, 0, -half],
      [x, 0, half],
      [x, top, half],
      [x, top, -half],
    ];
    faces.push({
      id: which === 0 ? 'start' : 'end',
      part: 'end',
      ...room(end),
      finish: end.finish ?? wall.finish,
      outline: which === 0 ? outline : outline.reverse(),
      holes: [],
    });
  });

  // The reveals: the wall's depth around each opening, in two halves, each with the finish of
  // the long face it meets. The halves meet in the middle of the wall, where the frame stands.
  for (const c of cuts) {
    const mid = (c.from + c.to) / 2;
    for (const side of [1, -1] as const) {
      const run = runAt(runs[side], mid);
      if (!run) continue;
      const [lo, hi] = side > 0 ? [0, half] : [-half, 0];
      const name = side > 0 ? 'front' : 'back';
      const reveal = (id: string, outline: Vec3[]) =>
        faces.push({
          id: `reveal:${c.id}:${id}-${name}`,
          part: 'reveal',
          ...room(run),
          openingId: c.id,
          finish: run.finish,
          outline,
          holes: [],
        });
      if (c.from > EPS) {
        reveal('left', [
          [c.from, c.bottom, hi],
          [c.from, c.bottom, lo],
          [c.from, c.top, lo],
          [c.from, c.top, hi],
        ]);
      }
      if (c.to < length - EPS) {
        reveal('right', [
          [c.to, c.bottom, lo],
          [c.to, c.bottom, hi],
          [c.to, c.top, hi],
          [c.to, c.top, lo],
        ]);
      }
      if (c.top < height - EPS) {
        reveal('head', [
          [c.from, c.top, lo],
          [c.to, c.top, lo],
          [c.to, c.top, hi],
          [c.from, c.top, hi],
        ]);
      }
      if (c.bottom > EPS) {
        reveal('sill', [
          [c.from, c.bottom, hi],
          [c.to, c.bottom, hi],
          [c.to, c.bottom, lo],
          [c.from, c.bottom, lo],
        ]);
      }
    }
  }
  return faces;
}

/** How a wall's faces take their texture: along the wall from its start, up from its floor. */
export const wallUv = (start: Vec3, [dx, dz]: Vec2): UvFrame => ({
  origin: start,
  u: [dx, 0, dz],
  v: [0, 1, 0],
});
