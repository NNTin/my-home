import { wallLength, type HomeModel, type Point } from '@my-home/shared';
import type { Box, HomeScene, Vec2 } from '../builder/buildHome';
import { slopeY } from '../builder/buildHome';
import {
  add,
  distanceToSegment,
  dot,
  length,
  pointInPolygon,
  rotate,
  scale,
  segmentRectangle,
  sub,
} from '../editor/geometry';

/**
 * Where a figure can walk: pure geometry derived from the home model and its render
 * descriptors, no three.js. Two kinds of things matter:
 *
 * - **Surfaces** carry the figure: level floors, stair treads, terrain patches and outbuilding
 *   floors. The figure stands on the surface under it that is within one step of its feet, so
 *   stairs, outdoor steps and gentle slopes work, and a drop or a bank that is too high or too
 *   steep stops it.
 * - **Blockers** stop it sideways: walls (with their doorways left open), fences (gates are
 *   open), outbuilding walls and furniture. Each blocks only where it overlaps the figure's body
 *   in height, so walls of another level do not matter.
 */

/** The figure's body: a circle on the plan, this tall, with its eyes at `EYE_HEIGHT`. */
export const FIGURE_RADIUS = 0.22;
export const FIGURE_HEIGHT = 1.7;
export const EYE_HEIGHT = 1.6;
/** Highest step the figure takes up or down; a riser is at most 0.19 m, outdoor steps 0.32 m. */
export const MAX_STEP = 0.4;
/** Steepest slope it walks on (rise per metre run): about 31°. */
export const MAX_GRADIENT = 0.6;
/** Half the thickness of a fence, which the model describes as a line. */
const FENCE_HALF_THICKNESS = 0.04;

export interface Surface {
  kind: 'floor' | 'stair' | 'terrain';
  /** The level of a floor; for a stair tread the level it is nearer to. */
  levelId?: string;
  outline: Vec2[];
  holes: Vec2[][];
  /** Points this close outside the outline still stand on it (doorways in exterior walls). */
  margin: number;
  heightAt(point: Vec2): number;
}

export interface Blocker {
  /** Convex polygon on the plan. */
  polygon: Vec2[];
  bottom: number;
  top: number;
}

export interface WalkWorld {
  surfaces: Surface[];
  blockers: Blocker[];
}

/** Where the figure's feet are. */
export interface Footing {
  x: number;
  z: number;
  /** Height of the feet. */
  y: number;
  /** The level it is on indoors (or on a stair); undefined outdoors. */
  levelId?: string;
}

const toVec2 = (p: Point): Vec2 => [p.x.value, p.z.value];

const boxPolygon = (box: Box): Vec2[] => {
  const [sx, , sz] = box.size;
  const center: Vec2 = [box.center[0], box.center[2]];
  return (
    [
      [-sx / 2, -sz / 2],
      [sx / 2, -sz / 2],
      [sx / 2, sz / 2],
      [-sx / 2, sz / 2],
    ] as Vec2[]
  ).map((p) => add(rotate(p, box.rotationY), center));
};

/** The parts `[from, to]` of a line of `length` left over when the `gaps` are cut out. */
function withoutGaps(total: number, gaps: [number, number][]): [number, number][] {
  const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
  const parts: [number, number][] = [];
  let at = 0;
  for (const [from, to] of sorted) {
    if (from > at + 1e-6) parts.push([at, Math.min(from, total)]);
    at = Math.max(at, to);
  }
  if (at < total - 1e-6) parts.push([at, total]);
  return parts;
}

const passable = (type: string) => type === 'door' || type === 'french-door';

/** Rectangles along `start`-`end` for every part that is not a doorway. */
function wallPieces(
  start: Vec2,
  end: Vec2,
  thickness: number,
  doorways: [number, number][],
): Vec2[][] {
  const total = length(sub(end, start));
  if (total < 1e-6) return [];
  const dir = scale(sub(end, start), 1 / total);
  return withoutGaps(total, doorways).map(([from, to]) =>
    segmentRectangle(add(start, scale(dir, from)), add(start, scale(dir, to)), thickness),
  );
}

export interface FurnitureBlocker {
  levelId: string;
  /** Convex footprint on the plan. */
  polygon: Vec2[];
  height: number;
}

export function buildWalkWorld(
  model: HomeModel,
  scene: HomeScene,
  furniture: FurnitureBlocker[] = [],
): WalkWorld {
  const levels = new Map(scene.levels.map((l) => [l.id, l]));
  const surfaces: Surface[] = [];
  const blockers: Blocker[] = [];

  // Floors reach to the middle of the exterior walls; a doorway needs the other half too.
  const exterior = model.walls.filter((w) => w.kind === 'exterior').map((w) => w.thickness.value);
  const threshold = Math.max(0, ...exterior) / 2 + 0.05;
  for (const slab of scene.slabs) {
    const level = levels.get(slab.levelId);
    if (slab.kind !== 'floor' || !level) continue;
    surfaces.push({
      kind: 'floor',
      levelId: level.id,
      outline: slab.outline,
      holes: slab.holes,
      margin: threshold,
      heightAt: () => level.elevation,
    });
  }

  for (const stair of scene.stairs) {
    const from = levels.get(stair.levelId)?.elevation ?? 0;
    const to = levels.get(stair.toLevelId)?.elevation ?? from;
    for (const step of stair.steps) {
      const top = step.center[1] + step.size[1] / 2;
      surfaces.push({
        kind: 'stair',
        levelId: top - from < (to - from) / 2 ? stair.levelId : stair.toLevelId,
        outline: boxPolygon(step),
        holes: [],
        margin: 0,
        heightAt: () => top,
      });
    }
  }

  for (const patch of scene.terrain) {
    const { slope } = patch;
    if (slope && Math.abs(slope.high - slope.low) > MAX_GRADIENT * Math.abs(slope.to - slope.from))
      continue;
    surfaces.push({
      kind: 'terrain',
      outline: patch.outline,
      holes: patch.holes,
      margin: 0,
      heightAt: (p) => (slope ? slopeY(slope, p) : patch.top),
    });
  }

  for (const wall of model.walls) {
    const level = levels.get(wall.levelId);
    if (!level) continue;
    const doorways = model.openings
      .filter((o) => o.wallId === wall.id && passable(o.type) && o.sill.value <= MAX_STEP)
      .map((o): [number, number] => [o.offset.value, o.offset.value + o.width.value]);
    for (const polygon of wallPieces(
      toVec2(wall.start),
      toVec2(wall.end),
      wall.thickness.value,
      doorways,
    )) {
      blockers.push({
        polygon,
        bottom: level.elevation,
        top: level.elevation + wall.height.value,
      });
    }
  }

  for (const fence of model.fences ?? []) {
    if (fence.kind === 'gate') continue;
    const points = fence.path.map(toVec2);
    points.slice(0, -1).forEach((start, i) => {
      blockers.push({
        polygon: segmentRectangle(start, points[i + 1]!, 2 * FENCE_HALF_THICKNESS),
        bottom: -Infinity,
        top: Infinity,
      });
    });
  }

  for (const building of model.outbuildings ?? []) {
    const floor = building.floorElevation.value;
    const points = building.footprint.map(toVec2);
    surfaces.push({
      kind: 'terrain',
      outline: points,
      holes: [],
      margin: 0,
      heightAt: () => floor,
    });
    points.forEach((start, edge) => {
      if (building.openEdges?.includes(edge)) return;
      const end = points[(edge + 1) % points.length]!;
      const doorways = (building.openings ?? [])
        .filter((o) => o.edge === edge && passable(o.type) && o.sill.value <= MAX_STEP)
        .map((o): [number, number] => [o.offset.value, o.offset.value + o.width.value]);
      for (const polygon of wallPieces(start, end, building.wallThickness.value, doorways)) {
        blockers.push({ polygon, bottom: floor, top: floor + building.height.value });
      }
    });
  }

  for (const item of furniture) {
    const level = levels.get(item.levelId);
    if (!level) continue;
    blockers.push({
      polygon: item.polygon,
      bottom: level.elevation,
      top: level.elevation + item.height,
    });
  }

  return { surfaces, blockers };
}

const onSurface = (surface: Surface, point: Vec2) =>
  pointInPolygon(point, surface.outline, surface.margin) &&
  !surface.holes.some((hole) => pointInPolygon(point, hole));

/**
 * The surface that carries a figure at `point` whose feet are at `y`: the highest one within one
 * step, since surfaces are solid below (a tread over the floor carries, not the floor under it).
 * Nothing within a step means a drop, a bank or a void.
 */
export function supportAt(
  world: WalkWorld,
  point: Vec2,
  y: number,
): { y: number; surface: Surface } | undefined {
  let best: { y: number; surface: Surface } | undefined;
  for (const surface of world.surfaces) {
    if (!onSurface(surface, point)) continue;
    const height = surface.heightAt(point);
    if (Math.abs(height - y) <= MAX_STEP && (!best || height > best.y)) {
      best = { y: height, surface };
    }
  }
  if (!best) return undefined;
  // No headroom: something to stand on hangs over this spot lower than the figure is tall
  // (the underside of a stair flight).
  const blocked = world.surfaces.some((surface) => {
    if (surface.kind !== 'stair' || !onSurface(surface, point)) return false;
    const height = surface.heightAt(point);
    return height > best.y + MAX_STEP && height < best.y + FIGURE_HEIGHT;
  });
  return blocked ? undefined : best;
}

/** The closest point on the boundary of a polygon. */
function closestOnBoundary(point: Vec2, polygon: Vec2[]): Vec2 {
  let best: Vec2 = polygon[0]!;
  let bestDistance = Infinity;
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length]!;
    const ab = sub(b, a);
    const len2 = dot(ab, ab);
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(point, a), ab) / len2));
    const q = add(a, scale(ab, t));
    const distance = length(sub(point, q));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = q;
    }
  });
  return best;
}

const overlapsBody = (blocker: Blocker, y: number) =>
  blocker.top > y + MAX_STEP && blocker.bottom < y + FIGURE_HEIGHT;

/** Moves a circle at `point` out of every blocker it overlaps; undefined when it stays stuck. */
function pushOut(world: WalkWorld, point: Vec2, y: number, radius: number): Vec2 | undefined {
  let p = point;
  const near = world.blockers.filter((b) => overlapsBody(b, y));
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const blocker of near) {
      const q = closestOnBoundary(p, blocker.polygon);
      const offset = sub(p, q);
      const distance = length(offset);
      const inside = pointInPolygon(p, blocker.polygon);
      if (!inside && distance >= radius - 1e-9) continue;
      if (distance < 1e-9) return undefined;
      // Outside: away from the boundary until the circle clears it. Inside: through it.
      const push = inside ? -(distance + radius) : radius - distance;
      p = add(p, scale(offset, push / distance));
      moved = true;
    }
    if (!moved) return p;
  }
  const clear = near.every(
    (b) =>
      !pointInPolygon(p, b.polygon) &&
      b.polygon.every(
        (a, i) => distanceToSegment(p, a, b.polygon[(i + 1) % b.polygon.length]!) >= radius - 1e-3,
      ),
  );
  return clear ? p : undefined;
}

const footing = (point: Vec2, support: { y: number; surface: Surface }): Footing => ({
  x: point[0],
  z: point[1],
  y: support.y,
  ...(support.surface.kind !== 'terrain' &&
    support.surface.levelId !== undefined && { levelId: support.surface.levelId }),
});

function tryMove(world: WalkWorld, from: Footing, target: Vec2, radius: number) {
  const free = pushOut(world, target, from.y, radius);
  if (!free) return undefined;
  const support = supportAt(world, free, from.y);
  return support && footing(free, support);
}

/** Longest stretch moved in one go, so a fast figure cannot skip through a thin wall. */
const SUBSTEP = 0.08;

/**
 * Walks the figure by `delta` on the plan. It slides along walls and furniture, climbs steps and
 * slopes, and stops at anything it cannot pass. Returns the same footing when it cannot move.
 */
export function walk(
  world: WalkWorld,
  from: Footing,
  delta: Vec2,
  radius = FIGURE_RADIUS,
): Footing {
  const distance = length(delta);
  if (distance < 1e-9) return from;
  const steps = Math.ceil(distance / SUBSTEP);
  const step = scale(delta, 1 / steps);
  let at = from;
  for (let i = 0; i < steps; i++) {
    const here: Vec2 = [at.x, at.z];
    const next =
      tryMove(world, at, add(here, step), radius) ??
      // Blocked by a drop or a corner: keep the part of the move along one axis.
      (Math.abs(step[0]) >= Math.abs(step[1])
        ? (tryMove(world, at, add(here, [step[0], 0]), radius) ??
          tryMove(world, at, add(here, [0, step[1]]), radius))
        : (tryMove(world, at, add(here, [0, step[1]]), radius) ??
          tryMove(world, at, add(here, [step[0], 0]), radius)));
    if (!next) break;
    at = next;
  }
  // Pressed against something: not moving, rather than creeping by rounding errors.
  return Math.hypot(at.x - from.x, at.z - from.z) < 1e-6 && at.y === from.y ? from : at;
}

/** Puts a figure down at a plan point: on the surface nearest to height `y` there. */
export function placeAt(world: WalkWorld, point: Vec2, y: number): Footing | undefined {
  let best: { y: number; surface: Surface } | undefined;
  for (const surface of world.surfaces) {
    if (!onSurface(surface, point)) continue;
    const height = surface.heightAt(point);
    if (!best || Math.abs(height - y) < Math.abs(best.y - y)) best = { y: height, surface };
  }
  return best && footing(point, best);
}

export interface StartPose extends Footing {
  yaw: number;
}

/** Yaw (counter-clockwise from above, 0 = looking along -z) that looks along a plan direction. */
export const yawTowards = ([dx, dz]: Vec2) => Math.atan2(-dx, -dz);

/**
 * Where the figure starts: just inside the first entrance that is a door, facing into the room.
 * Without one it starts at the foot of an entrance stair, else in the middle of the first room.
 */
export function startPose(model: HomeModel, world: WalkWorld): StartPose | undefined {
  const levelOf = (id: string) => model.levels.find((l) => l.id === id)?.elevation.value ?? 0;
  const entrances = model.apartments.flatMap((a) => a.entrances ?? []);
  for (const entrance of entrances) {
    const door = model.openings.find((o) => o.id === entrance.viaId);
    const wall = door && model.walls.find((w) => w.id === door.wallId);
    const room = model.rooms.find((r) => r.id === entrance.roomId);
    if (!door || !wall || !room) continue;
    const start = toVec2(wall.start);
    const dir = scale(sub(toVec2(wall.end), start), 1 / wallLength(wall));
    const middle = add(start, scale(dir, door.offset.value + door.width.value / 2));
    const normal: Vec2 = [-dir[1], dir[0]];
    const reach = wall.thickness.value / 2 + FIGURE_RADIUS + 0.4;
    for (const side of [1, -1]) {
      const inward = scale(normal, side);
      const point = add(middle, scale(inward, reach));
      if (!pointInPolygon(point, room.outline.map(toVec2))) continue;
      const placed = placeAt(world, point, levelOf(room.levelId));
      if (placed) return { ...placed, yaw: yawTowards(inward) };
    }
  }
  for (const entrance of entrances) {
    const stair = model.stairs?.find((s) => s.id === entrance.viaId);
    const room = model.rooms.find((r) => r.id === entrance.roomId);
    if (!stair || !room) continue;
    const path = stair.path.map(toVec2);
    const up = room.levelId === stair.levelId;
    const [end, next] = up ? [path[0]!, path[1]!] : [path.at(-1)!, path.at(-2)!];
    // One step back from the end of the stair, looking along it.
    const along = scale(sub(next, end), 1 / (length(sub(next, end)) || 1));
    const placed = placeAt(world, sub(end, scale(along, 0.5)), levelOf(room.levelId));
    if (placed) return { ...placed, yaw: yawTowards(along) };
  }
  const lowest = [...model.levels].sort((a, b) => a.elevation.value - b.elevation.value);
  for (const level of lowest) {
    for (const room of model.rooms.filter((r) => r.levelId === level.id)) {
      const outline = room.outline.map(toVec2);
      const middle = scale(
        outline.reduce((sum, p) => add(sum, p), [0, 0] as Vec2),
        1 / outline.length,
      );
      const placed = placeAt(world, middle, level.elevation.value);
      if (placed) return { ...placed, yaw: 0 };
    }
  }
  return undefined;
}
