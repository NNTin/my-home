import type { HomeModel } from '@my-home/shared';
import type { EditorItem } from './item';
import type { Vec2 } from '../builder/buildHome';
import { UNKNOWN_SIZE, type FurnitureRegistry, type ResolvedFurniture } from '../catalog/furniture';
import { findCollisions, type Collision } from './collision';
import { floorPlan, type FloorPlan } from './floorPlan';
import { normalizeAngle, rectangle, transform } from './geometry';
import { constrainMove, isInside, allowedArea, placementPosition, roomAt } from './placement';
import { snapAngle, snapToGrid, snapToWalls, DEFAULT_GRID_STEP } from './snapping';

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
}

export function createContext(
  model: HomeModel,
  furniture: FurnitureRegistry,
  settings: EditorSettings = defaultSettings,
): EditorContext {
  const plans = new Map<string, FloorPlan>();
  for (const level of model.levels) plans.set(level.id, floorPlan(model, level.id)!);
  return { furniture, plans, settings };
}

export { UNKNOWN_SIZE };

export const typeOf = (ctx: EditorContext, item: EditorItem): ResolvedFurniture | undefined =>
  ctx.furniture.resolve(item.typeId, item.params);

export const localFootprint = (ctx: EditorContext, item: EditorItem): Vec2[] =>
  typeOf(ctx, item)?.footprint ?? rectangle(UNKNOWN_SIZE.width, UNKNOWN_SIZE.depth);

export const positionOf = (item: EditorItem): Vec2 => [item.position.x, item.position.z];

export const worldFootprint = (ctx: EditorContext, item: EditorItem, at = positionOf(item)) =>
  transform(localFootprint(ctx, item), at, item.rotationY);

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
}

export function issuesOf(ctx: EditorContext, item: EditorItem): ItemIssues {
  const plan = ctx.plans.get(item.levelId);
  return {
    unknownType: !typeOf(ctx, item),
    missingLevel: !plan,
    missingRoom:
      item.roomId !== undefined && (!plan || !plan.rooms.some((r) => r.id === item.roomId)),
  };
}

export const hasIssues = (i: ItemIssues) => i.unknownType || i.missingLevel || i.missingRoom;

/** Footprint collisions of all items, level by level. */
export function collisions(ctx: EditorContext, items: EditorItem[]): Map<string, Collision> {
  const result = new Map<string, Collision>();
  const byLevel = new Map<string, EditorItem[]>();
  for (const item of items) byLevel.set(item.levelId, [...(byLevel.get(item.levelId) ?? []), item]);
  for (const [levelId, levelItems] of byLevel) {
    const plan = ctx.plans.get(levelId);
    if (!plan) continue;
    const found = findCollisions(
      levelItems.map((i) => ({ id: i.id, polygon: worldFootprint(ctx, i) })),
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
  const polygon = worldFootprint(ctx, item, p);
  if (!isInside(allowedArea(plan, p), polygon)) return false;
  const placed = [
    { id: item.id, polygon },
    ...others(items, item.id)
      .filter((i) => i.levelId === item.levelId)
      .map((i) => ({ id: i.id, polygon: worldFootprint(ctx, i) })),
  ];
  return !findCollisions(placed, plan.walls).has(item.id);
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
  const draft: EditorItem = {
    id,
    typeId,
    levelId,
    position: { x: 0, z: 0 },
    rotationY: 0,
    params,
    name: '',
  };
  if (!plan) return draft;
  const p = placementPosition(plan, roomId, (p) => fitsAt(ctx, plan, draft, p, items));
  return withPosition(ctx, draft, ctx.settings.grid ? snapToGrid(p, ctx.settings.gridStep) : p);
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
  if (settings.wallSnap && type) {
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
  return withPosition(ctx, item, constrained, rotationY);
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
  const p = placementPosition(plan, roomId ?? plan.rooms[0]?.id, (p) =>
    fitsAt(ctx, plan, moved, p, items),
  );
  return withPosition(ctx, moved, p);
}
