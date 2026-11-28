import type { Vec2 } from '../geom/types';
import type { FloorPlan, PlanRoom } from './floorPlan';
import { add, centroid, pointInPolygon } from '../geom/geometry';

/** Points within this distance (1 cm) of a room edge count as inside it. */
export const INSIDE_TOLERANCE = 0.01;

export function roomAt(plan: FloorPlan, point: Vec2): PlanRoom | undefined {
  return plan.rooms.find((r) => pointInPolygon(point, r.outline, INSIDE_TOLERANCE));
}

/**
 * The area an item may stand in: the rooms of the apartment it is in (or of any apartment when
 * it is in no room yet). Levels without rooms fall back to the building footprint. An outdoor
 * piece stands in the outdoor areas (not on a road).
 */
export function allowedArea(plan: FloorPlan, center: Vec2, outdoor = false): Vec2[][] {
  if (outdoor) return plan.outdoor;
  if (plan.rooms.length === 0) return [plan.footprint];
  const room = roomAt(plan, center);
  if (!room) return plan.rooms.map((r) => r.outline);
  return plan.rooms.filter((r) => r.apartmentId === room.apartmentId).map((r) => r.outline);
}

/** Every corner and edge midpoint of the footprint lies in one of the area's polygons. */
export function isInside(area: Vec2[][], polygon: Vec2[]): boolean {
  const samples = polygon.flatMap((p, i) => {
    const q = polygon[(i + 1) % polygon.length]!;
    return [p, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as Vec2];
  });
  return samples.every((s) => area.some((a) => pointInPolygon(s, a, INSIDE_TOLERANCE)));
}

/**
 * Keeps a move inside the apartment. `footprintAt(p)` is the item's footprint at position `p`.
 * A move that would leave the area slides along the boundary (keeping one axis) or stays put.
 * An item that is already outside (e.g. after the building changed) may move freely as long as
 * its centre is in the area, so it can be rescued.
 */
export function constrainMove(
  plan: FloorPlan,
  from: Vec2,
  to: Vec2,
  footprintAt: (p: Vec2) => Vec2[],
  outdoor = false,
): Vec2 {
  const area = allowedArea(plan, from, outdoor);
  const ok = (p: Vec2) => isInside(area, footprintAt(p));
  if (ok(to)) return to;
  const slideX: Vec2 = [to[0], from[1]];
  if (ok(slideX)) return slideX;
  const slideZ: Vec2 = [from[0], to[1]];
  if (ok(slideZ)) return slideZ;
  if (!ok(from) && area.some((a) => pointInPolygon(to, a, INSIDE_TOLERANCE))) return to;
  return from;
}

/**
 * Where a new item goes in a room: the room's centre, or the nearest free spot on a spiral
 * around it (25 cm steps, up to 3 m) where it fits inside the room without collisions.
 */
export function placementPosition(
  plan: FloorPlan,
  roomId: string | undefined,
  fits: (p: Vec2) => boolean,
): Vec2 {
  const room = plan.rooms.find((r) => r.id === roomId);
  const center = centroid(room ? room.outline : plan.footprint);
  const step = 0.25;
  for (let ring = 0; ring <= 12; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const p = add(center, [i * step, j * step]);
        if (fits(p)) return p;
      }
    }
  }
  return center;
}
