import type { ParamValues, TypeId } from '@my-home/shared';
import type { Vec3 } from '../builder/buildHome';

/**
 * The contract of a piece module: how one catalogue type (`@my-home/shared` `catalog`) is drawn.
 * One module per type lives in `src/catalog/<family>/<variant>/index.ts` and default-exports
 * `definePiece({...})`; the registry discovers it at build time. See docs/adding-piece-type.md.
 *
 * Local frame: openings are centred on the hole, width along x, height along y, the wall's depth
 * along z. Furniture stands on the floor at the origin, width along x, depth along z (the front
 * faces +z). Units are metres.
 */

/** Where the piece goes: an opening's hole; for furniture the size from its parameters. */
export interface PieceContext {
  width: number;
  height: number;
  wallDepth: number;
}

export type PartRole = 'frame' | 'sash' | 'glass' | 'panel' | 'leaf' | 'post' | 'body' | 'detail';

/** Material settings beyond the colour; each is three.js' default when omitted. */
export interface PartMaterial {
  transparent?: boolean;
  opacity?: number;
  depthWrite?: boolean;
  metalness?: number;
  roughness?: number;
  /** Shadows default to on (cast and receive). */
  castShadow?: boolean;
  receiveShadow?: boolean;
}

/** One solid of a piece, in its local frame. */
export interface Part {
  shape: 'box' | 'cylinder';
  center: Vec3;
  /** Box: [x, y, z] extents. Cylinder: [diameter, height, diameter]; unequal x/z make it elliptic. */
  size: Vec3;
  rotationY: number;
  color: string;
  material?: PartMaterial;
  role: PartRole;
}

/** A dimension to show next to the piece, in its local frame. */
export interface DimensionLine {
  from: Vec3;
  to: Vec3;
  /** Metres. */
  value: number;
  label: string;
}

/** Furniture highlight: selected in the editor, or overlapping a wall or another item. */
export interface PartState {
  selected: boolean;
  colliding: boolean;
}

export interface PieceModule {
  /** The shared catalogue type's id; equals the folder `<family>/<variant>` as `family.variant`. */
  id: TypeId;
  /** The solids of the piece for these (effective) values. Pure; never throws for valid values. */
  parts(values: ParamValues, ctx: PieceContext): Part[];
  dimensions(values: ParamValues, ctx: PieceContext): DimensionLine[];
}

/** Identity helper that type-checks a module definition. */
export const definePiece = (module: PieceModule): PieceModule => module;
