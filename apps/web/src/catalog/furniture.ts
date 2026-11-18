import {
  catalog,
  effectiveParams,
  LEGACY_FURNITURE_TYPE_IDS,
  type CatalogType,
  type ParamValues,
} from '@my-home/shared';
import type { Vec2 } from '../builder/buildHome';
import { ellipse, rectangle } from '../editor/geometry';
import { box } from './parts';
import { pieces } from './registry';
import { sizeOf } from './furniture/size';
import type { Part, PieceModule } from './types';

/**
 * Furniture as the editor and the viewer use it: catalogue types of kind `furniture` with their
 * piece modules, keyed by the type id (`furniture.bed`). The legacy item ids of the old named
 * layouts (`bed`, see `LEGACY_FURNITURE_TYPE_IDS`) resolve too.
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
  /** The id the old named layouts stored, e.g. `bed`. */
  legacyId: string;
  type: CatalogType;
  piece: PieceModule;
  name: string;
  icon: string;
  description: string;
  category: string;
  snapping: WallSnap;
}

/** A layout item's type with its effective values: what it is drawn and collides as. */
export interface ResolvedFurniture extends FurnitureType {
  values: ParamValues;
  size: ItemSize;
  /** Convex footprint in the local frame (x, z), from the effective size. */
  footprint: Vec2[];
  parts: Part[];
}

export interface FurnitureCategory {
  name: string;
  types: FurnitureType[];
}

export interface FurnitureRegistry {
  /** Grouped by category, then sorted by name (category order alphabetical). */
  categories: FurnitureCategory[];
  /** By type id or legacy id. */
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
const CACHE_LIMIT = 500;

export const unknownParts = (size = UNKNOWN_SIZE, color = UNKNOWN_COLOR): Part[] => [
  box([0, size.height / 2, 0], [size.width, size.height, size.depth], color, 'body'),
];

export function createFurniture(types: readonly CatalogType[] = catalog.types): FurnitureRegistry {
  const legacyOf = new Map(Object.entries(LEGACY_FURNITURE_TYPE_IDS).map(([k, v]) => [v, k]));
  const byId = new Map<string, FurnitureType>();
  for (const type of types) {
    if (type.kind !== 'furniture') continue;
    const piece = pieces.get(type.id);
    const legacyId = legacyOf.get(type.id);
    if (!piece || !legacyId) {
      throw new Error(`Furniture type ${type.id} needs a piece and a legacy id`);
    }
    byId.set(type.id, {
      id: type.id,
      legacyId,
      type,
      piece,
      name: type.name,
      icon: type.icon,
      description: type.description,
      category: type.category ?? 'Other',
      snapping: type.snapping?.wall ?? 'none',
    });
  }
  const sorted = [...byId.values()].sort(
    (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );
  const categories: FurnitureCategory[] = [];
  for (const type of sorted) {
    const last = categories.at(-1);
    if (last?.name === type.category) last.types.push(type);
    else categories.push({ name: type.category, types: [type] });
  }
  const get = (id: string) => byId.get(id) ?? byId.get(LEGACY_FURNITURE_TYPE_IDS[id] ?? '');
  const resolve = (id: string, props: unknown): ResolvedFurniture | undefined => {
    const found = get(id);
    if (!found) return undefined;
    const { values } = effectiveParams(found.type, props);
    const size = sizeOf(values);
    const footprint =
      found.type.footprint === 'ellipse'
        ? ellipse(size.width, size.depth)
        : rectangle(size.width, size.depth);
    const parts = found.piece.parts(values, {
      width: size.width,
      height: size.height,
      wallDepth: size.depth,
    });
    return { ...found, values, size, footprint, parts };
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
