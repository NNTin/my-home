import { wallLength, type HomeModel, type Point } from '@my-home/shared';
import { splitWall, type Vec2 } from '../builder/buildHome';
import { add, scale, segmentRectangle, sub } from './geometry';

/** What the furniture editor needs to know about one level, in plan coordinates. */
export interface PlanRoom {
  id: string;
  name: string;
  apartmentId?: string;
  outline: Vec2[];
}

export interface PlanWall {
  id: string;
  kind: 'exterior' | 'interior';
  apartmentId?: string;
  start: Vec2;
  end: Vec2;
  thickness: number;
  /**
   * Rectangles of the wall that furniture on the floor bumps into: everything except the space
   * above a window's sill or a door, so items can stand under windows and doorways stay passable.
   */
  solids: Vec2[][];
  /**
   * Every solid piece of the wall with its height above the floor, so raised items (a wall
   * cabinet) bump into the pieces at their height (`findCollisions`). Absent: `solids` only.
   */
  spans?: WallSpan[];
}

export interface WallSpan {
  polygon: Vec2[];
  bottom: number;
  top: number;
}

export interface FloorPlan {
  levelId: string;
  levelName: string;
  /** Floor height (top of the slab), where items stand. */
  elevation: number;
  rooms: PlanRoom[];
  walls: PlanWall[];
  /** Building footprint: the allowed area on levels without rooms. */
  footprint: Vec2[];
}

const toVec2 = (p: Point): Vec2 => [p.x.value, p.z.value];

/**
 * Pieces of a wall that reach into an item's lowest 40 cm count as solid for it: for an item
 * on the floor, sills below that are obstacles, a window above it is not.
 */
export const FURNITURE_HEIGHT = 0.4;

export function floorPlan(model: HomeModel, levelId: string): FloorPlan | undefined {
  const level = model.levels.find((l) => l.id === levelId);
  if (!level) return undefined;
  const openingsByWall = new Map<string, HomeModel['openings']>();
  for (const o of model.openings)
    openingsByWall.set(o.wallId, [...(openingsByWall.get(o.wallId) ?? []), o]);

  const walls: PlanWall[] = model.walls
    .filter((w) => w.levelId === levelId)
    .map((w) => {
      const start = toVec2(w.start);
      const end = toVec2(w.end);
      const len = wallLength(w);
      const dir = scale(sub(end, start), 1 / len);
      const spans = splitWall(
        len,
        w.height.value,
        (openingsByWall.get(w.id) ?? []).map((o) => ({
          offset: o.offset.value,
          width: o.width.value,
          sill: o.sill.value,
          height: o.height.value,
        })),
      );
      const pieces = spans.map((s) => ({
        polygon: segmentRectangle(
          add(start, scale(dir, s.from)),
          add(start, scale(dir, s.to)),
          w.thickness.value,
        ),
        bottom: s.bottom,
        top: s.top,
      }));
      const solids = pieces.filter((s) => s.bottom < FURNITURE_HEIGHT).map((s) => s.polygon);
      return {
        id: w.id,
        kind: w.kind,
        ...(w.apartmentId !== undefined && { apartmentId: w.apartmentId }),
        start,
        end,
        thickness: w.thickness.value,
        solids,
        spans: pieces,
      };
    });

  return {
    levelId,
    levelName: level.name,
    elevation: level.elevation.value,
    rooms: model.rooms
      .filter((r) => r.levelId === levelId)
      .map((r) => ({
        id: r.id,
        name: r.name,
        ...(r.apartmentId !== undefined && { apartmentId: r.apartmentId }),
        outline: r.outline.map(toVec2),
      })),
    walls,
    footprint: model.building.footprint.map(toVec2),
  };
}
