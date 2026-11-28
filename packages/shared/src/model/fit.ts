import { distanceToOutline, insideOutline, type Polygon } from './home-model';
import { formatCm } from '../catalog/format';
import type { ParamValues } from '../catalog/params';
import type { CatalogType } from '../catalog/types';

const EPS = 1e-6;
/** A corner on the room's outline (flush with a wall) still fits: 1 mm. */
const TOLERANCE = 1e-3;

const numberOf = (values: ParamValues, key: string): number | undefined => {
  const value = values[key];
  return typeof value === 'number' ? value : undefined;
};

/**
 * Why the values do not fit the hole of an opening, as sentences (empty when they fit). For now:
 * every counted part with a minimum width (a sash, a leaf) needs that much of the hole's width.
 */
export function openingFitIssues(
  type: CatalogType,
  values: ParamValues,
  hole: { width: number; height: number },
): string[] {
  const issues: string[] = [];
  for (const [key, spec] of Object.entries(type.params)) {
    if (spec.type !== 'count' || !spec.each) continue;
    const n = numberOf(values, key) ?? spec.default;
    const needed = n * spec.each.minWidth;
    if (needed > hole.width + EPS) {
      const what = `${n} ${n === 1 ? spec.each.one : spec.each.other}`;
      issues.push(
        `${what} ${n === 1 ? 'needs' : 'need'} at least ${formatCm(needed)}, the opening is ${formatCm(hole.width)}`,
      );
    }
  }
  return issues;
}

/**
 * A piece of furniture's size from its parameters: `width`, `depth` (or `length`, along the bed)
 * and `height`; a round piece's `diameter` is its width and depth.
 */
export function furnitureSize(values: ParamValues): {
  width: number;
  depth: number;
  height: number;
} {
  const diameter = numberOf(values, 'diameter');
  return {
    width: numberOf(values, 'width') ?? diameter ?? 0,
    depth: numberOf(values, 'depth') ?? numberOf(values, 'length') ?? diameter ?? 0,
    // A piece with a diameter and no height (a log lying down) is as high as it is thick.
    height: numberOf(values, 'height') ?? diameter ?? 0,
  };
}

/** Footprint points in the local frame: the rectangle's corners, or 16 samples of the ellipse. */
function footprintPoints(type: CatalogType, values: ParamValues): [number, number][] {
  const { width, depth } = furnitureSize(values);
  const [rx, rz] = [width / 2, depth / 2];
  if (type.footprint === 'ellipse') {
    return Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * 2 * Math.PI;
      return [Math.cos(a) * rx, Math.sin(a) * rz];
    });
  }
  return [
    [-rx, -rz],
    [rx, -rz],
    [rx, rz],
    [-rx, rz],
  ];
}

/** Whether (x, z) is inside the polygon and more than `TOLERANCE` from its edges. */
function strictlyInside(x: number, z: number, polygon: [number, number][]): boolean {
  let inside = false;
  let distance = Infinity;
  polygon.forEach(([ax, az], i) => {
    const [bx, bz] = polygon[(i + 1) % polygon.length]!;
    if (az > z !== bz > z && x < ax + ((z - az) / (bz - az)) * (bx - ax)) inside = !inside;
    const [dx, dz] = [bx - ax, bz - az];
    const length2 = dx * dx + dz * dz;
    const t = length2 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / length2)) : 0;
    distance = Math.min(distance, Math.hypot(x - ax - t * dx, z - az - t * dz));
  });
  return inside && distance > TOLERANCE;
}

/**
 * Why a piece of furniture at a position does not fit its room (empty when it fits, or without a
 * room). The rotation is three.js `rotation.y`: a local point (x, z) lands at
 * `(x cos r + z sin r, -x sin r + z cos r)`, as in the web editor. It does not fit when a corner
 * of its footprint is outside the room, or, in a concave room, when a corner of the room pokes
 * into the footprint.
 */
export function furnitureFitIssues(
  type: CatalogType,
  values: ParamValues,
  at: { x: number; z: number; rotationY: number },
  room?: { outline: Polygon },
): string[] {
  if (!room) return [];
  const [c, s] = [Math.cos(at.rotationY), Math.sin(at.rotationY)];
  const footprint = footprintPoints(type, values).map(([x, z]): [number, number] => [
    at.x + x * c + z * s,
    at.z - x * s + z * c,
  ]);
  const outside = footprint.some(
    ([px, pz]) =>
      !insideOutline(px, pz, room.outline) && distanceToOutline(px, pz, room.outline) > TOLERANCE,
  );
  const poking = room.outline.some((p) => strictlyInside(p.x.value, p.z.value, footprint));
  if (!outside && !poking) return [];
  const { width, depth } = furnitureSize(values);
  return [
    `The ${type.name.toLowerCase()} (${formatCm(width)} × ${formatCm(depth)}) reaches outside the room`,
  ];
}
