import type { ComponentType } from 'react';
import type { Vec2 } from '../builder/buildHome';

/**
 * The contract every furniture type implements. One module per type lives in
 * `src/items/<id>/index.tsx` and default-exports `defineItemType({...})`; the registry discovers
 * it at build time, so adding a type needs no change to core code. See
 * docs/adding-furniture-type.md.
 *
 * Local frame: the origin is the centre of the item on the floor, `width` runs along local x,
 * `depth` along local z (the front faces +z) and `height` up. Units are metres.
 */

export interface ItemSize {
  width: number;
  depth: number;
  height: number;
}

/**
 * How the item snaps to walls when wall snapping is on:
 * - `back`: turns its back (local -z side) to a nearby wall and moves flush against it
 * - `any`: aligns any side with a nearby wall and moves flush against it
 * - `none`: never snaps to walls
 */
export type WallSnap = 'back' | 'any' | 'none';

export interface SnappingRules {
  wall: WallSnap;
}

export interface ItemRenderProps {
  size: ItemSize;
  /** Base colour; the module may derive darker/lighter shades from it. */
  color: string;
  selected: boolean;
  /** The footprint overlaps a wall or another item. */
  colliding: boolean;
}

export interface ItemTypeModule {
  /** Unique id stored in layouts (`typeId`); must equal the module folder name. */
  id: string;
  name: string;
  /**
   * Catalog group. Any string; the catalog groups types by it. Where a group stands for a kind of
   * room, it is spelled like the rooms of the home ("Bed room", "Work room"): one vocabulary.
   */
  category: string;
  /** Short icon for the catalog (an emoji or a few characters). */
  icon: string;
  description?: string;
  /** Default size of a newly placed item. */
  size: ItemSize;
  color: string;
  /**
   * Convex 2D footprint in the local frame (x, z), used for collision and wall snapping.
   * Defaults to the `width` x `depth` rectangle.
   */
  footprint?: Vec2[];
  snapping: SnappingRules;
  /** R3F component drawing the item in its local frame (simple boxes and cylinders for now). */
  Render: ComponentType<ItemRenderProps>;
}

/** Identity helper that type-checks a module definition. */
export const defineItemType = (module: ItemTypeModule): ItemTypeModule => module;
