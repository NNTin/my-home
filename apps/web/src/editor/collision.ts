import type { Vec2 } from '../builder/buildHome';
import type { PlanWall } from './floorPlan';
import { boundsOf, convexOverlap } from './geometry';

/** An item's footprint in plan coordinates. */
export interface PlacedFootprint {
  id: string;
  polygon: Vec2[];
}

export interface Collision {
  itemIds: string[];
  wallIds: string[];
}

/** Overlaps smaller than this (5 mm) are ignored, so snapped items touching a wall are fine. */
export const COLLISION_TOLERANCE = 0.005;

/**
 * Footprint collisions among items on one level and against that level's walls. Returns only
 * the colliding items; footprints must be convex.
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
      if (convexOverlap(a.polygon, b.polygon, tolerance)) {
        entry(a.id).itemIds.push(b.id);
        entry(b.id).itemIds.push(a.id);
      }
    }
    for (const wall of walls) {
      if (wall.solids.some((solid) => convexOverlap(a.polygon, solid, tolerance))) {
        entry(a.id).wallIds.push(wall.id);
      }
    }
  }
  return result;
}
