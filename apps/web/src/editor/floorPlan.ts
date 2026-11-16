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
   * Rectangles of the wall that furniture bumps into: everything except the space above a
   * window's sill or a door, so items can stand under windows and doorways stay passable.
   */
  solids: Vec2[][];
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

/** Pieces of a wall that are lower than this count as solid; sills below are obstacles. */
const FURNITURE_HEIGHT = 0.4;

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
      const solids = spans
        .filter((s) => s.bottom < FURNITURE_HEIGHT)
        .map((s) =>
          segmentRectangle(
            add(start, scale(dir, s.from)),
            add(start, scale(dir, s.to)),
            w.thickness.value,
          ),
        );
      return {
        id: w.id,
        kind: w.kind,
        ...(w.apartmentId !== undefined && { apartmentId: w.apartmentId }),
        start,
        end,
        thickness: w.thickness.value,
        solids,
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
