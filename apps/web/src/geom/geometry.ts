import type { Vec2 } from './types';

/**
 * 2D plan geometry for the furniture editor: plain numbers, no three.js. Plan points are `[x, z]`
 * (x east, z south). A rotation `r` about +y turns local `(x, z)` into
 * `(x cos r + z sin r, -x sin r + z cos r)`, the same as three.js `rotation.y`.
 */

export type { Vec2 };

export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
export const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
export const length = (a: Vec2) => Math.hypot(a[0], a[1]);

export const rotate = ([x, z]: Vec2, r: number): Vec2 => {
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [x * c + z * s, -x * s + z * c];
};

/** The plan angle of a direction, in the same sense as `rotationY` (counter-clockwise from above). */
export const angleOf = ([x, z]: Vec2) => Math.atan2(-z, x);

/** Normalises an angle to (-π, π]. */
export function normalizeAngle(a: number) {
  const t = a % (2 * Math.PI);
  const n = t > Math.PI ? t - 2 * Math.PI : t <= -Math.PI ? t + 2 * Math.PI : t;
  return Object.is(n, -0) ? 0 : n;
}

/** Smallest signed difference `a - b`, in (-π, π]. */
export const angleDiff = (a: number, b: number) => normalizeAngle(a - b);

/** Corners of a `width` (local x) by `depth` (local z) rectangle centred on the origin. */
export const rectangle = (width: number, depth: number): Vec2[] => [
  [-width / 2, -depth / 2],
  [width / 2, -depth / 2],
  [width / 2, depth / 2],
  [-width / 2, depth / 2],
];

/** A local polygon placed at `position` with rotation `rotationY`. */
export const transform = (polygon: Vec2[], position: Vec2, rotationY: number): Vec2[] =>
  polygon.map((p) => add(rotate(p, rotationY), position));

/** Rectangle around the segment `start`-`end`, `thickness` wide (a wall piece). */
export function segmentRectangle(start: Vec2, end: Vec2, thickness: number): Vec2[] {
  const d = sub(end, start);
  const len = length(d) || 1;
  const n: Vec2 = [(-d[1] / len) * (thickness / 2), (d[0] / len) * (thickness / 2)];
  return [add(start, n), add(end, n), sub(end, n), sub(start, n)];
}

export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2) {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2));
  return length(sub(p, add(a, scale(ab, t))));
}

/** Point in polygon (ray casting); points within `tolerance` of an edge count as inside. */
export function pointInPolygon(p: Vec2, polygon: Vec2[], tolerance = 0): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (tolerance > 0 && distanceToSegment(p, a, b) <= tolerance) return true;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

/** Area-weighted centroid (vertex average for degenerate polygons). */
export function centroid(polygon: Vec2[]): Vec2 {
  let area = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [x0, z0] = polygon[j]!;
    const [x1, z1] = polygon[i]!;
    const cross = x0 * z1 - x1 * z0;
    area += cross;
    cx += (x0 + x1) * cross;
    cz += (z0 + z1) * cross;
  }
  if (Math.abs(area) < 1e-12) {
    const sum = polygon.reduce((s, p) => add(s, p), [0, 0] as Vec2);
    return scale(sum, 1 / Math.max(polygon.length, 1));
  }
  return [cx / (3 * area), cz / (3 * area)];
}

export interface Bounds {
  min: Vec2;
  max: Vec2;
}

export function boundsOf(polygon: Vec2[]): Bounds {
  const xs = polygon.map((p) => p[0]);
  const zs = polygon.map((p) => p[1]);
  return { min: [Math.min(...xs), Math.min(...zs)], max: [Math.max(...xs), Math.max(...zs)] };
}

const boundsOverlap = (a: Bounds, b: Bounds, tolerance: number) =>
  a.min[0] < b.max[0] - tolerance &&
  b.min[0] < a.max[0] - tolerance &&
  a.min[1] < b.max[1] - tolerance &&
  b.min[1] < a.max[1] - tolerance;

function project(polygon: Vec2[], axis: Vec2): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of polygon) {
    const v = dot(p, axis);
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  return [min, max];
}

/**
 * Whether two convex polygons overlap by more than `tolerance` (separating axis theorem).
 * Polygons that only touch, such as an item snapped against a wall, do not overlap.
 */
export function convexOverlap(a: Vec2[], b: Vec2[], tolerance = 1e-3): boolean {
  if (!boundsOverlap(boundsOf(a), boundsOf(b), tolerance)) return false;
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i]!;
      const q = polygon[(i + 1) % polygon.length]!;
      const edge = sub(q, p);
      const len = length(edge);
      if (len < 1e-12) continue;
      const axis: Vec2 = [-edge[1] / len, edge[0] / len];
      const [minA, maxA] = project(a, axis);
      const [minB, maxB] = project(b, axis);
      if (Math.min(maxA, maxB) - Math.max(minA, minB) <= tolerance) return false;
    }
  }
  return true;
}

/** Regular polygon approximating a circle or ellipse, for round footprints. */
export const ellipse = (width: number, depth: number, segments = 16): Vec2[] =>
  Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * 2 * Math.PI;
    return [(Math.cos(a) * width) / 2, (Math.sin(a) * depth) / 2] as Vec2;
  });
