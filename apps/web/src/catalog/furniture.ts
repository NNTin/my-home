import {
  catalog,
  effectiveParams,
  isOutdoorKind,
  isPlacedKind,
  type CatalogType,
  type ParamValues,
} from '@my-home/shared';
import type { Vec2 } from '../builder/buildHome';
import { ellipse, rectangle } from '../editor/geometry';
import { box } from './parts';
import { pieces } from './registry';
import { sizeOf } from './furniture/size';
import type { Part, PieceEmitter, PieceModule } from './types';

/**
 * Furniture as the editor and the viewer use it: catalogue types placed in rooms (kinds
 * `furniture` and `fixtures`) with their piece modules, keyed by the type id (`furniture.bed`).
 */

/** Size of a piece of furniture in metres: `width` along local x, `depth` along z, `height` up. */
export interface ItemSize {
  width: number;
  depth: number;
  height: number;
}

/**
 * How an item snaps to walls when wall snapping is on:
 * - `back`: turns its back (local -z side) to a nearby wall and moves flush against it
 * - `any`: aligns any side with a nearby wall and moves flush against it
 * - `none`: never snaps to walls
 */
export type WallSnap = 'back' | 'any' | 'none';

/** A furniture type as the catalogue panel lists it; `id` (the type id) is what a new item stores. */
export interface FurnitureType {
  id: string;
  type: CatalogType;
  piece: PieceModule;
  name: string;
  icon: string;
  description: string;
  category: string;
  snapping: WallSnap;
  /** An outdoor piece: it stands on the ground where it is placed, not on its level's floor. */
  outdoor: boolean;
  /**
   * It takes no floor space (footprint `none`: an open pergola, a stepping stone): it collides with
   * nothing and never blocks the walking figure.
   */
  open: boolean;
}

/** A placement's type with its effective values: what it is drawn and collides as. */
export interface ResolvedFurniture extends FurnitureType {
  values: ParamValues;
  size: ItemSize;
  /** Convex footprint in the local frame (x, z), from the effective size. */
  footprint: Vec2[];
  parts: Part[];
  /** The light it emits, in the local frame; empty for most types. */
  emitters: PieceEmitter[];
}

export interface FurnitureCategory {
  name: string;
  types: FurnitureType[];
}

export interface FurnitureRegistry {
  /**
   * What the "Add" panel offers: every furniture and fixture type (on the floor, on a wall or under
   * the ceiling), grouped by category, then sorted by name (category order alphabetical). Outdoor
   * pieces are not offered: the panel adds to a room.
   */
  categories: FurnitureCategory[];
  /** By type id. */
  get(id: string): FurnitureType | undefined;
  /**
   * The item's type with `props` applied as overrides (invalid ones are ignored). Cached per
   * type and props: collision checks and snapping resolve every item on each pointer move, so
   * the result is shared and must not be changed.
   */
  resolve(id: string, props?: unknown): ResolvedFurniture | undefined;
}

/** Items of an unknown type (e.g. a removed one) are drawn and collide as this grey box. */
export const UNKNOWN_SIZE: ItemSize = { width: 0.5, depth: 0.5, height: 0.5 };
const UNKNOWN_COLOR = '#9e9e9e';
/** One array for every type that emits no light. */
const NO_EMITTERS: PieceEmitter[] = [];
const CACHE_LIMIT = 500;

export const unknownParts = (size = UNKNOWN_SIZE, color = UNKNOWN_COLOR): Part[] => [
  box([0, size.height / 2, 0], [size.width, size.height, size.depth], color, 'body'),
];

export function createFurniture(types: readonly CatalogType[] = catalog.types): FurnitureRegistry {
  const byId = new Map<string, FurnitureType>();
  for (const type of types) {
    if (!isPlacedKind(type)) continue;
    const piece = pieces.get(type.id);
    if (!piece) throw new Error(`Furniture type ${type.id} needs a piece`);
    byId.set(type.id, {
      id: type.id,
      type,
      piece,
      name: type.name,
      icon: type.icon,
      description: type.description,
      category: type.category ?? 'Other',
      snapping: type.snapping?.wall ?? 'none',
      outdoor: isOutdoorKind(type),
      open: type.footprint === 'none',
    });
  }
  // The "Add" panel puts a new piece in a room, so it offers no outdoor pieces (agents place them).
  const sorted = [...byId.values()]
    .filter((t) => !t.outdoor)
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const categories: FurnitureCategory[] = [];
  for (const type of sorted) {
    const last = categories.at(-1);
    if (last?.name === type.category) last.types.push(type);
    else categories.push({ name: type.category, types: [type] });
  }
  const get = (id: string) => byId.get(id);
  const resolve = (id: string, props: unknown): ResolvedFurniture | undefined => {
    const found = get(id);
    if (!found) return undefined;
    const { values } = effectiveParams(found.type, props);
    const size = sizeOf(values);
    const footprint =
      found.type.footprint === 'ellipse'
        ? ellipse(size.width, size.depth)
        : rectangle(size.width, size.depth);
    const ctx = { width: size.width, height: size.height, wallDepth: size.depth };
    const parts = found.piece.parts(values, ctx);
    const emitters = found.piece.emits?.(values, ctx) ?? NO_EMITTERS;
    return { ...found, values, size, footprint, parts, emitters };
  };
  const cache = new Map<string, ResolvedFurniture | undefined>();
  return {
    categories,
    get,
    resolve(id, props) {
      const key = `${id}\u0000${props === undefined ? '' : JSON.stringify(props)}`;
      if (cache.has(key)) return cache.get(key);
      const resolved = resolve(id, props);
      if (cache.size >= CACHE_LIMIT) cache.clear();
      cache.set(key, resolved);
      return resolved;
    },
  };
}

export const furniture = createFurniture();
