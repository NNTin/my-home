import type { Vec2 } from '../builder/buildHome';
import type { WallSnap } from '../catalog/furniture';
import type { PlanWall } from './floorPlan';
import { angleDiff, dot, length, normalizeAngle, rotate, scale, sub, transform } from './geometry';

export const DEFAULT_GRID_STEP = 0.1;
/** Walls closer than this (25 cm) pull an item flush against them. */
export const WALL_SNAP_DISTANCE = 0.25;
/** Items within this angle (12°) of a wall's direction are turned to line up with it. */
export const WALL_SNAP_ANGLE = (12 * Math.PI) / 180;

/** Rounds to a multiple of `step`, then to micrometres to drop floating-point noise. */
const round = (value: number, step: number) =>
  Math.round(Math.round(value / step) * step * 1e6) / 1e6;

export const snapToGrid = ([x, z]: Vec2, step = DEFAULT_GRID_STEP): Vec2 => [
  round(x, step),
  round(z, step),
];

/** Snaps an angle to multiples of `step` (radians); `step <= 0` only normalises it. */
export const snapAngle = (angle: number, step: number) =>
  normalizeAngle(step > 0 ? round(angle, step) : angle);

/** Rotation from dragging a handle around `center` from `start` to `current`. */
export function rotationFromDrag(
  center: Vec2,
  start: Vec2,
  current: Vec2,
  startRotation: number,
  step: number,
) {
  const angle = (v: Vec2) => Math.atan2(-v[1], v[0]);
  const delta = angle(sub(current, center)) - angle(sub(start, center));
  return snapAngle(startRotation + delta, step);
}

interface Face {
  wallId: string;
  /** A point on the face and its unit direction along the wall. */
  origin: Vec2;
  dir: Vec2;
  /** Unit normal pointing from the wall towards the item. */
  normal: Vec2;
  length: number;
}

/** The face of `wall` on the side of `center`. */
function faceTowards(wall: PlanWall, center: Vec2): Face | undefined {
  const along = sub(wall.end, wall.start);
  const len = length(along);
  if (len < 1e-9) return undefined;
  const dir = scale(along, 1 / len);
  const n: Vec2 = [-dir[1], dir[0]];
  const side = Math.sign(dot(sub(center, wall.start), n)) || 1;
  const normal = scale(n, side);
  return {
    wallId: wall.id,
    origin: [
      wall.start[0] + normal[0] * (wall.thickness / 2),
      wall.start[1] + normal[1] * (wall.thickness / 2),
    ],
    dir,
    normal,
    length: len,
  };
}

/** Rotation that turns the item's front (local +z) to `normal`, i.e. its back to the wall. */
const facing = (normal: Vec2) => Math.atan2(normal[0], normal[1]);

/** Gap between the face and the footprint (negative when it pokes through), if it is in reach. */
function gapTo(face: Face, polygon: Vec2[]): number | undefined {
  let min = Infinity;
  let from = Infinity;
  let to = -Infinity;
  for (const p of polygon) {
    const rel = sub(p, face.origin);
    min = Math.min(min, dot(rel, face.normal));
    const t = dot(rel, face.dir);
    from = Math.min(from, t);
    to = Math.max(to, t);
  }
  // The item must be alongside the wall, not beyond its ends.
  if (to <= 0 || from >= face.length) return undefined;
  return min;
}

export interface SnapInput {
  position: Vec2;
  rotationY: number;
  /** Local footprint. */
  footprint: Vec2[];
  rule: WallSnap;
  walls: PlanWall[];
  distance?: number;
  /** How far the second wall (into a corner) pulls; `distance` when omitted. */
  cornerDistance?: number;
  angle?: number;
}

export interface SnapResult {
  position: Vec2;
  rotationY: number;
  wallIds: string[];
}

/**
 * Wall snapping: lines the item up with the nearest wall within reach (its back for `back`,
 * any side for `any`), moves it flush against that wall's face, then does the same with one
 * more wall at an angle to the first so items settle into corners.
 */
export function snapToWalls(input: SnapInput): SnapResult {
  const { footprint, rule, walls } = input;
  const reach = input.distance ?? WALL_SNAP_DISTANCE;
  const maxAngle = input.angle ?? WALL_SNAP_ANGLE;
  let position = input.position;
  let rotationY = input.rotationY;
  const snapped: Face[] = [];
  if (rule === 'none') return { position, rotationY, wallIds: [] };

  const targetRotation = (face: Face, current: number) => {
    const back = facing(face.normal);
    if (rule === 'back') return back;
    const quarter = Math.PI / 2;
    return back + Math.round(angleDiff(current, back) / quarter) * quarter;
  };

  for (let pass = 0; pass < 2; pass++) {
    let best: { face: Face; gap: number; rotationY: number } | undefined;
    for (const wall of walls) {
      const face = faceTowards(wall, position);
      if (!face) continue;
      if (snapped.some((s) => Math.abs(dot(s.dir, face.dir)) > 0.5)) continue;
      let r = rotationY;
      if (pass === 0) {
        // The first wall may turn the item to line up with it.
        r = targetRotation(face, rotationY);
        if (Math.abs(angleDiff(r, rotationY)) > maxAngle) continue;
      } else if (Math.abs(Math.sin(2 * angleDiff(rotationY, facing(face.normal)))) > 1e-3) {
        // A second wall only counts when the item is already square to it.
        continue;
      }
      const gap = gapTo(face, transform(footprint, position, r));
      const within = pass === 0 ? reach : (input.cornerDistance ?? reach);
      if (gap === undefined || Math.abs(gap) > within) continue;
      if (!best || Math.abs(gap) < Math.abs(best.gap)) best = { face, gap, rotationY: r };
    }
    if (!best) break;
    rotationY = normalizeAngle(best.rotationY);
    // Re-measure after turning, then move along the face normal by the gap.
    const gap = gapTo(best.face, transform(footprint, position, rotationY)) ?? best.gap;
    position = sub(position, scale(best.face.normal, gap));
    snapped.push(best.face);
  }
  return { position, rotationY, wallIds: snapped.map((f) => f.wallId) };
}

/** The local front direction of an item in plan coordinates (handy for tests and handles). */
export const frontOf = (rotationY: number) => rotate([0, 1], rotationY);
