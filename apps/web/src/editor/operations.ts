import {
  ceilingHeightAt,
  defaultElevation,
  heightFitIssues,
  MAX_ELEVATION,
  mountingOf,
  mountingsFor,
  wallBehind,
  type HomeModel,
  type PlacementMounting,
} from '@my-home/shared';
import { elevationOfItem, mountingOfItem, withMounting, type EditorItem } from './item';
import type { Vec2 } from '../builder/buildHome';
import { UNKNOWN_SIZE, type FurnitureRegistry, type ResolvedFurniture } from '../catalog/furniture';
import { findCollisions, type Collision } from './collision';
import { floorPlan, type FloorPlan } from './floorPlan';
import { length, normalizeAngle, rectangle, rotate, sub, transform } from './geometry';
import { constrainMove, isInside, allowedArea, placementPosition, roomAt } from './placement';
import {
  snapAngle,
  snapToGrid,
  snapToWalls,
  DEFAULT_GRID_STEP,
  WALL_SNAP_ANGLE,
  WALL_SNAP_DISTANCE,
  type SnapResult,
} from './snapping';

/**
 * Editing operations on furniture items: pure functions of the home, the furniture types and
 * settings. An item is sized from its type's effective values (`EditorItem.params` as overrides).
 */

export interface EditorSettings {
  grid: boolean;
  gridStep: number;
  wallSnap: boolean;
  /** Rotation step in radians for `R` and the rotate handle; 0 = free. */
  rotationStep: number;
}

export const defaultSettings: EditorSettings = {
  grid: true,
  gridStep: DEFAULT_GRID_STEP,
  wallSnap: true,
  rotationStep: Math.PI / 2,
};

export interface EditorContext {
  furniture: FurnitureRegistry;
  plans: Map<string, FloorPlan>;
  settings: EditorSettings;
  /** What heights depend on: the levels and lowered ceilings, the walls wall pieces hang on. */
  model: Pick<HomeModel, 'levels' | 'ceilings' | 'walls'>;
}

export function createContext(
  model: HomeModel,
  furniture: FurnitureRegistry,
  settings: EditorSettings = defaultSettings,
): EditorContext {
  const plans = new Map<string, FloorPlan>();
  for (const level of model.levels) plans.set(level.id, floorPlan(model, level.id)!);
  return { furniture, plans, settings, model };
}

export { UNKNOWN_SIZE };

export const typeOf = (ctx: EditorContext, item: EditorItem): ResolvedFurniture | undefined =>
  ctx.furniture.resolve(item.typeId, item.params);

export const localFootprint = (ctx: EditorContext, item: EditorItem): Vec2[] =>
  typeOf(ctx, item)?.footprint ?? rectangle(UNKNOWN_SIZE.width, UNKNOWN_SIZE.depth);

export const positionOf = (item: EditorItem): Vec2 => [item.position.x, item.position.z];

export const worldFootprint = (ctx: EditorContext, item: EditorItem, at = positionOf(item)) =>
  transform(localFootprint(ctx, item), at, item.rotationY);

/** How far a dragged wall piece looks for a wall to hang on (1 m). */
export const WALL_MOUNT_REACH = 1;
/** How far a ceiling piece counts as hanging down, for collisions (5 cm). */
export const CEILING_HANG = 0.05;

/** The ceiling over the item's position, above its level's floor. */
const ceilingAt = (ctx: EditorContext, item: EditorItem, [x, z] = positionOf(item)) =>
  ceilingHeightAt(ctx.model, item.levelId, x, z);

/**
 * The heights the item takes up above its level's floor: from its elevation up by its height, or
 * for a ceiling piece the last few centimetres under the ceiling over it.
 */
export function heightRange(
  ctx: EditorContext,
  item: EditorItem,
  at = positionOf(item),
): { bottom: number; top: number } {
  if (mountingOfItem(item) === 'ceiling') {
    const ceiling = ceilingAt(ctx, item, at) ?? 0;
    return { bottom: ceiling - CEILING_HANG, top: ceiling };
  }
  const bottom = elevationOfItem(item);
  return { bottom, top: bottom + (typeOf(ctx, item)?.size ?? UNKNOWN_SIZE).height };
}

/** Where the item's frame starts above its level's floor: its elevation, or the ceiling over it. */
export const mountHeightOf = (ctx: EditorContext, item: EditorItem): number =>
  mountingOfItem(item) === 'ceiling' ? (ceilingAt(ctx, item) ?? 0) : elevationOfItem(item);

const placedFootprint = (ctx: EditorContext, item: EditorItem, at = positionOf(item)) => ({
  id: item.id,
  polygon: worldFootprint(ctx, item, at),
  ...heightRange(ctx, item, at),
});

/** Whether the item at `at` reaches above the ceiling over it. */
function tooHigh(ctx: EditorContext, item: EditorItem, [x, z] = positionOf(item)): boolean {
  const type = typeOf(ctx, item);
  if (!type) return false;
  const at = { levelId: item.levelId, x, z };
  const mounting = mountingOfItem(item);
  return (
    heightFitIssues(ctx.model, type.type, type.values, at, mounting, elevationOfItem(item)).length >
    0
  );
}

/**
 * A wall piece at `p` hung on the nearest wall within `WALL_MOUNT_REACH`: its back flush against
 * the wall's face, turned to it (and into a corner when there is one). Undefined without a wall.
 */
function hangOnWall(
  ctx: EditorContext,
  plan: FloorPlan,
  item: EditorItem,
  p: Vec2,
  rotationY = item.rotationY,
): { position: Vec2; rotationY: number } | undefined {
  const snap = (angle: number) =>
    snapToWalls({
      position: p,
      rotationY,
      footprint: localFootprint(ctx, item),
      rule: 'back',
      walls: plan.walls,
      distance: WALL_MOUNT_REACH,
      cornerDistance: WALL_SNAP_DISTANCE,
      angle,
    });
  const any = snap(Math.PI);
  if (any.wallIds.length === 0) return undefined;
  // A wall it already lines up with wins unless another is clearly nearer, so a piece dragged
  // along its wall does not jump to the next wall at the corner.
  const keep = snap(WALL_SNAP_ANGLE);
  const moved = (s: SnapResult) => length(sub(s.position, p));
  return keep.wallIds.length > 0 && moved(keep) <= moved(any) + WALL_KEEP_MARGIN ? keep : any;
}

/** How much nearer another wall must be before a dragged wall piece changes walls (15 cm). */
const WALL_KEEP_MARGIN = 0.15;

const withPosition = (
  ctx: EditorContext,
  item: EditorItem,
  [x, z]: Vec2,
  rotationY = item.rotationY,
): EditorItem => {
  const plan = ctx.plans.get(item.levelId);
  const room = plan && roomAt(plan, [x, z]);
  const rest = { ...item };
  delete rest.roomId;
  return {
    ...rest,
    ...(room && { roomId: room.id }),
    position: { x, z },
    rotationY: normalizeAngle(rotationY),
  };
};

/** Flags for items whose references no longer resolve; such items are kept, never deleted. */
export interface ItemIssues {
  unknownType: boolean;
  missingLevel: boolean;
  missingRoom: boolean;
  /** A wall piece whose back is not against a wall (its wall is gone or moved). */
  offWall: boolean;
  /** It reaches above the ceiling over it. */
  aboveCeiling: boolean;
}

export function issuesOf(ctx: EditorContext, item: EditorItem): ItemIssues {
  const plan = ctx.plans.get(item.levelId);
  return {
    unknownType: !typeOf(ctx, item),
    missingLevel: !plan,
    missingRoom:
      item.roomId !== undefined && (!plan || !plan.rooms.some((r) => r.id === item.roomId)),
    offWall: !!plan && isOffWall(ctx, item),
    aboveCeiling: !!plan && tooHigh(ctx, item),
  };
}

function isOffWall(ctx: EditorContext, item: EditorItem): boolean {
  const type = typeOf(ctx, item);
  if (!type || mountingOfItem(item) !== 'wall') return false;
  const at = { levelId: item.levelId, ...item.position, rotationY: item.rotationY };
  return !wallBehind(ctx.model, at, type.size.depth);
}

export const hasIssues = (i: ItemIssues) =>
  i.unknownType || i.missingLevel || i.missingRoom || i.offWall || i.aboveCeiling;

/** Footprint collisions of all items, level by level. */
export function collisions(ctx: EditorContext, items: EditorItem[]): Map<string, Collision> {
  const result = new Map<string, Collision>();
  const byLevel = new Map<string, EditorItem[]>();
  for (const item of items) byLevel.set(item.levelId, [...(byLevel.get(item.levelId) ?? []), item]);
  for (const [levelId, levelItems] of byLevel) {
    const plan = ctx.plans.get(levelId);
    if (!plan) continue;
    const found = findCollisions(
      levelItems.map((i) => placedFootprint(ctx, i)),
      plan.walls,
    );
    for (const [id, c] of found) result.set(id, c);
  }
  return result;
}

const others = (items: EditorItem[], id: string) => items.filter((i) => i.id !== id);

/** Whether `item` at `p` is inside its area and collides with nothing. */
function fitsAt(
  ctx: EditorContext,
  plan: FloorPlan,
  item: EditorItem,
  p: Vec2,
  items: EditorItem[],
) {
  const self = placedFootprint(ctx, item, p);
  if (!isInside(allowedArea(plan, p), self.polygon)) return false;
  if (tooHigh(ctx, item, p)) return false;
  const placed = [
    self,
    ...others(items, item.id)
      .filter((i) => i.levelId === item.levelId)
      .map((i) => placedFootprint(ctx, i)),
  ];
  return !findCollisions(placed, plan.walls).has(item.id);
}

/**
 * The first free spot for `item` in a room (`placementPosition`); a wall piece hung on the
 * nearest wall to each candidate.
 */
function freeSpot(
  ctx: EditorContext,
  plan: FloorPlan,
  item: EditorItem,
  roomId: string | undefined,
  items: EditorItem[],
): EditorItem {
  if (mountingOfItem(item) !== 'wall') {
    const p = placementPosition(plan, roomId, (p) => fitsAt(ctx, plan, item, p, items));
    return withPosition(ctx, item, ctx.settings.grid ? snapToGrid(p, ctx.settings.gridStep) : p);
  }
  const hung = (p: Vec2) => {
    const at = hangOnWall(ctx, plan, item, p, 0);
    return (
      at && { ...item, rotationY: at.rotationY, position: { x: at.position[0], z: at.position[1] } }
    );
  };
  const p = placementPosition(plan, roomId, (p) => {
    const at = hung(p);
    return !!at && fitsAt(ctx, plan, at, positionOf(at), items);
  });
  const at = hung(p) ?? item;
  return withPosition(ctx, at, positionOf(at), at.rotationY);
}

/** A new item of `typeId` in `roomId` on `levelId`, at the first free spot near the room centre. */
export function createItem(
  ctx: EditorContext,
  items: EditorItem[],
  {
    id,
    typeId,
    levelId,
    roomId,
    params = {},
  }: {
    id: string;
    typeId: string;
    levelId: string;
    roomId?: string;
    /** Basic overrides: the free spot is found for the size they give. */
    params?: EditorItem['params'];
  },
): EditorItem {
  const plan = ctx.plans.get(levelId);
  const type = ctx.furniture.get(typeId)?.type;
  const mounting = type ? mountingsFor(type)[0]! : 'floor';
  const draft = withMounting(
    { id, typeId, levelId, position: { x: 0, z: 0 }, rotationY: 0, params, name: '' },
    mounting,
    type ? defaultElevation(type, mounting) : 0,
  );
  if (!plan) return draft;
  return freeSpot(ctx, plan, draft, roomId, items);
}

/**
 * Moves an item towards `target` (the pointer on the floor): grid snapping, then wall snapping
 * (which may also turn it to face away from the wall), then the stay-inside constraint.
 */
export function moveItem(ctx: EditorContext, item: EditorItem, target: Vec2): EditorItem {
  const plan = ctx.plans.get(item.levelId);
  if (!plan) return item;
  const { settings } = ctx;
  let p = settings.grid ? snapToGrid(target, settings.gridStep) : target;
  let rotationY = item.rotationY;
  const type = typeOf(ctx, item);
  const onWall = mountingOfItem(item) === 'wall';
  if (onWall) {
    // A wall piece always hangs on a wall: it slides along it and jumps to the nearest one.
    const hung = hangOnWall(ctx, plan, item, p, rotationY);
    if (!hung) return item;
    p = hung.position;
    rotationY = hung.rotationY;
  } else if (settings.wallSnap && type) {
    const snapped = snapToWalls({
      position: p,
      rotationY,
      footprint: localFootprint(ctx, item),
      rule: type.snapping,
      walls: plan.walls,
    });
    p = snapped.position;
    rotationY = snapped.rotationY;
  }
  const local = localFootprint(ctx, item);
  const constrained = constrainMove(plan, positionOf(item), p, (q) =>
    transform(local, q, rotationY),
  );
  // Sliding along the apartment's edge would take a wall piece off its wall.
  if (onWall && (constrained[0] !== p[0] || constrained[1] !== p[1])) return item;
  // Nor may a move take a piece that fits under the ceiling under a lower one (a box).
  if (!tooHigh(ctx, item) && tooHigh(ctx, item, constrained)) return item;
  return withPosition(ctx, item, constrained, rotationY);
}

/**
 * Sets the height of the item's bottom above the floor, in whole centimetres between 0 and
 * `MAX_ELEVATION`; a ceiling piece has none.
 */
export function setElevation(_ctx: EditorContext, item: EditorItem, elevation: number): EditorItem {
  const mounting = mountingOfItem(item);
  if (mounting === 'ceiling' || !Number.isFinite(elevation)) return item;
  const cm = Math.round(Math.min(MAX_ELEVATION, Math.max(0, elevation)) * 100) / 100;
  return withMounting(item, mounting, cm);
}

/**
 * Changes what the item is fixed to (one of `mountingsFor` its type): a wall piece is hung on the
 * nearest wall and keeps its height; on the floor it stands at the type's elevation (0 for a type
 * that hangs on a wall).
 */
export function setMounting(
  ctx: EditorContext,
  item: EditorItem,
  mounting: PlacementMounting,
): EditorItem {
  const type = typeOf(ctx, item)?.type;
  if (!type || !mountingsFor(type).includes(mounting) || mounting === mountingOfItem(item)) {
    return item;
  }
  const own = mountingOf(type);
  const elevation =
    mounting === 'floor' ? (own === 'floor' ? (type.elevation ?? 0) : 0) : elevationOfItem(item);
  const next = withMounting(item, mounting, elevation);
  const plan = ctx.plans.get(item.levelId);
  const hung = mounting === 'wall' && plan && hangOnWall(ctx, plan, next, positionOf(next));
  return hung ? withPosition(ctx, next, hung.position, hung.rotationY) : next;
}

/** Rotates by `steps` rotation steps (90° when rotation is free). */
export function rotateItem(ctx: EditorContext, item: EditorItem, steps: number): EditorItem {
  const step = ctx.settings.rotationStep > 0 ? ctx.settings.rotationStep : Math.PI / 2;
  return setRotation(ctx, item, snapAngle(item.rotationY, step) + steps * step);
}

export function setRotation(ctx: EditorContext, item: EditorItem, rotationY: number): EditorItem {
  return withPosition(ctx, item, positionOf(item), rotationY);
}

/**
 * A copy next to the original (or at the nearest free spot), under a new id and without a name
 * (the server names it, numbered: "Bedroom · Bed 2").
 */
export function duplicateItem(
  ctx: EditorContext,
  items: EditorItem[],
  item: EditorItem,
  id: string,
): EditorItem {
  const copy: EditorItem = structuredClone({ ...item, id, name: '' });
  const plan = ctx.plans.get(item.levelId);
  if (!plan) return copy;
  const [x, z] = positionOf(item);
  if (mountingOfItem(item) === 'wall') {
    // Along the wall, next to the original.
    const step = (typeOf(ctx, item)?.size ?? UNKNOWN_SIZE).width + 0.02;
    const along = [1, -1, 2, -2].map((k): Vec2 => {
      const [dx, dz] = rotate([k * step, 0], item.rotationY);
      return [x + dx, z + dz];
    });
    for (const p of along) {
      const at = hangOnWall(ctx, plan, copy, p);
      if (at && fitsAt(ctx, plan, { ...copy, rotationY: at.rotationY }, at.position, items)) {
        return withPosition(ctx, copy, at.position, at.rotationY);
      }
    }
    return withPosition(ctx, copy, [x, z]);
  }
  const candidates: Vec2[] = [0.3, 0.6, 1, 1.5].flatMap((d) => [
    [x + d, z + d],
    [x - d, z + d],
    [x + d, z - d],
    [x - d, z - d],
  ]);
  const spot = candidates.find((p) => fitsAt(ctx, plan, copy, p, items));
  const fallback = constrainMove(plan, [x, z], [x + 0.3, z + 0.3], (p) =>
    worldFootprint(ctx, copy, p),
  );
  return withPosition(ctx, copy, spot ?? fallback);
}

/** Moves an item whose level or room is gone to a room on `levelId` (rescue after a building change). */
export function relocateItem(
  ctx: EditorContext,
  items: EditorItem[],
  item: EditorItem,
  levelId: string,
  roomId?: string,
): EditorItem {
  const plan = ctx.plans.get(levelId);
  if (!plan) return item;
  const moved: EditorItem = { ...item, levelId };
  if (mountingOfItem(item) === 'wall') {
    return freeSpot(ctx, plan, moved, roomId ?? plan.rooms[0]?.id, items);
  }
  const p = placementPosition(plan, roomId ?? plan.rooms[0]?.id, (p) =>
    fitsAt(ctx, plan, moved, p, items),
  );
  return withPosition(ctx, moved, p);
}
