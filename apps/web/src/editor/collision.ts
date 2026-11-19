import type { Vec2 } from '../builder/buildHome';
import { FURNITURE_HEIGHT, type PlanWall } from './floorPlan';
import { boundsOf, convexOverlap } from './geometry';

/**
 * An item's footprint in plan coordinates, and the heights it takes up above the floor (on the
 * floor up to its height when omitted: it then meets every other item).
 */
export interface PlacedFootprint {
  id: string;
  polygon: Vec2[];
  bottom?: number;
  top?: number;
}

/** Whether two items take up overlapping heights (more than the tolerance). */
const overlapInHeight = (a: PlacedFootprint, b: PlacedFootprint, tolerance: number) =>
  Math.min(a.top ?? Infinity, b.top ?? Infinity) - Math.max(a.bottom ?? 0, b.bottom ?? 0) >
  tolerance;

/** The pieces of a wall an item bumps into: those reaching into its lowest 40 cm. */
function wallSolids(wall: PlanWall, item: PlacedFootprint): Vec2[][] {
  const bottom = item.bottom ?? 0;
  if (bottom === 0 || !wall.spans) return wall.solids;
  return wall.spans
    .filter((s) => s.bottom < bottom + FURNITURE_HEIGHT && s.top > bottom)
    .map((s) => s.polygon);
}

export interface Collision {
  itemIds: string[];
  wallIds: string[];
}

/** Overlaps smaller than this (5 mm) are ignored, so snapped items touching a wall are fine. */
export const COLLISION_TOLERANCE = 0.005;

/**
 * Footprint collisions among items on one level and against that level's walls. Items collide
 * only when they also overlap in height (a wall cabinet above a base cabinet does not). Returns
 * only the colliding items; footprints must be convex.
 */
export function findCollisions(
  items: PlacedFootprint[],
  walls: PlanWall[],
  tolerance = COLLISION_TOLERANCE,
): Map<string, Collision> {
  const result = new Map<string, Collision>();
  const entry = (id: string) => {
    let c = result.get(id);
    if (!c) result.set(id, (c = { itemIds: [], wallIds: [] }));
    return c;
  };
  // Sort by min x so the pair loop can stop early (sweep and prune).
  const sorted = items
    .map((item) => ({ ...item, bounds: boundsOf(item.polygon) }))
    .sort((a, b) => a.bounds.min[0] - b.bounds.min[0]);

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (b.bounds.min[0] >= a.bounds.max[0] - tolerance) break;
      if (overlapInHeight(a, b, tolerance) && convexOverlap(a.polygon, b.polygon, tolerance)) {
        entry(a.id).itemIds.push(b.id);
        entry(b.id).itemIds.push(a.id);
      }
    }
    for (const wall of walls) {
      if (wallSolids(wall, a).some((solid) => convexOverlap(a.polygon, solid, tolerance))) {
        entry(a.id).wallIds.push(wall.id);
      }
    }
  }
  return result;
}
