import type { HomeModel, LayoutItem } from '@my-home/shared';
import type { Vec2 } from '../builder/buildHome';
import type { ItemTypeRegistry } from '../items/registry';
import type { ItemSize, ItemTypeModule } from '../items/types';
import { findCollisions, type Collision } from './collision';
import { floorPlan, type FloorPlan } from './floorPlan';
import { normalizeAngle, rectangle, transform } from './geometry';
import { constrainMove, isInside, allowedArea, placementPosition, roomAt } from './placement';
import { snapAngle, snapToGrid, snapToWalls, DEFAULT_GRID_STEP } from './snapping';

/** Editing operations on layout items: pure functions of the home, the registry and settings. */

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
  registry: ItemTypeRegistry;
  plans: Map<string, FloorPlan>;
  settings: EditorSettings;
}

export function createContext(
  model: HomeModel,
  registry: ItemTypeRegistry,
  settings: EditorSettings = defaultSettings,
): EditorContext {
  const plans = new Map<string, FloorPlan>();
  for (const level of model.levels) plans.set(level.id, floorPlan(model, level.id)!);
  return { registry, plans, settings };
}

/** Items of an unknown type (e.g. a removed module) are drawn and collide as this box. */
export const UNKNOWN_SIZE: ItemSize = { width: 0.5, depth: 0.5, height: 0.5 };

export const typeOf = (ctx: EditorContext, item: LayoutItem): ItemTypeModule | undefined =>
  ctx.registry.get(item.typeId);

export const localFootprint = (ctx: EditorContext, item: LayoutItem): Vec2[] => {
  const type = typeOf(ctx, item);
  return type ? ctx.registry.footprint(type) : rectangle(UNKNOWN_SIZE.width, UNKNOWN_SIZE.depth);
};

export const positionOf = (item: LayoutItem): Vec2 => [item.position.x, item.position.z];

export const worldFootprint = (ctx: EditorContext, item: LayoutItem, at = positionOf(item)) =>
  transform(localFootprint(ctx, item), at, item.rotationY);

const withPosition = (
  ctx: EditorContext,
  item: LayoutItem,
  [x, z]: Vec2,
  rotationY = item.rotationY,
): LayoutItem => {
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

export function issuesOf(ctx: EditorContext, item: LayoutItem): ItemIssues {
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
export function collisions(ctx: EditorContext, items: LayoutItem[]): Map<string, Collision> {
  const result = new Map<string, Collision>();
  const byLevel = new Map<string, LayoutItem[]>();
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

const others = (items: LayoutItem[], id: string) => items.filter((i) => i.id !== id);

/** Whether `item` at `p` is inside its area and collides with nothing. */
function fitsAt(
  ctx: EditorContext,
  plan: FloorPlan,
  item: LayoutItem,
  p: Vec2,
  items: LayoutItem[],
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
  items: LayoutItem[],
  { id, typeId, levelId, roomId }: { id: string; typeId: string; levelId: string; roomId?: string },
): LayoutItem {
  const plan = ctx.plans.get(levelId);
  const draft: LayoutItem = {
    id,
    typeId,
    levelId,
    position: { x: 0, z: 0 },
    rotationY: 0,
    props: {},
  };
  if (!plan) return draft;
  const p = placementPosition(plan, roomId, (p) => fitsAt(ctx, plan, draft, p, items));
  return withPosition(ctx, draft, ctx.settings.grid ? snapToGrid(p, ctx.settings.gridStep) : p);
}

/**
 * Moves an item towards `target` (the pointer on the floor): grid snapping, then wall snapping
 * (which may also turn it to face away from the wall), then the stay-inside constraint.
 */
export function moveItem(ctx: EditorContext, item: LayoutItem, target: Vec2): LayoutItem {
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
      rule: type.snapping.wall,
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
export function rotateItem(ctx: EditorContext, item: LayoutItem, steps: number): LayoutItem {
  const step = ctx.settings.rotationStep > 0 ? ctx.settings.rotationStep : Math.PI / 2;
  return setRotation(ctx, item, snapAngle(item.rotationY, step) + steps * step);
}

export function setRotation(ctx: EditorContext, item: LayoutItem, rotationY: number): LayoutItem {
  return withPosition(ctx, item, positionOf(item), rotationY);
}

/** A copy next to the original (or at the nearest free spot), under a new id. */
export function duplicateItem(
  ctx: EditorContext,
  items: LayoutItem[],
  item: LayoutItem,
  id: string,
): LayoutItem {
  const copy: LayoutItem = structuredClone({ ...item, id });
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
  items: LayoutItem[],
  item: LayoutItem,
  levelId: string,
  roomId?: string,
): LayoutItem {
  const plan = ctx.plans.get(levelId);
  if (!plan) return item;
  const moved: LayoutItem = { ...item, levelId };
  const p = placementPosition(plan, roomId ?? plan.rooms[0]?.id, (p) =>
    fitsAt(ctx, plan, moved, p, items),
  );
  return withPosition(ctx, moved, p);
}
