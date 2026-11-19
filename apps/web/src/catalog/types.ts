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
  /** Wall openings: the hole's bottom above the floor, where known. */
  sill?: number;
  /**
   * Wall openings: which way local z points to the outdoors (1: +z, -1: -z). Windows put the
   * window board and the curtain on the room side, the outside sill and a shutter box outside.
   * The builder derives it from the building's footprint; the piece page shows the room side
   * (-1, the outdoors away from its camera).
   */
  outside?: 1 | -1;
  /**
   * Wall openings: the room between the top of the hole and the ceiling of its level, where known.
   * A window keeps its curtain rod under the ceiling.
   */
  headroom?: number;
}

export type PartRole =
  | 'frame'
  | 'sash'
  | 'glass'
  | 'panel'
  | 'leaf'
  | 'post'
  | 'body'
  | 'detail'
  | 'handle'
  | 'board'
  | 'sill'
  | 'shutter'
  | 'curtain';

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
  /** What is measured ("Width", "Sill height"), for the piece page's list of dimensions. */
  name?: string;
}

/** Furniture highlight: selected in the editor, or overlapping a wall or another item. */
export interface PartState {
  selected: boolean;
  colliding: boolean;
}

/** What a section shows: the parts' roles, plus the wall around the hole. */
export type SectionRole = PartRole | 'wall';

/**
 * One rectangle of a vertical cut through an opening's centre, perpendicular to the wall: `z` is
 * the depth (the local z, across the wall) and `y` the height (local y), both [min, max] metres.
 */
export interface SectionShape {
  role: SectionRole;
  color: string;
  z: [number, number];
  y: [number, number];
}

export interface PieceModule {
  /** The shared catalogue type's id; equals the folder `<family>/<variant>` as `family.variant`. */
  id: TypeId;
  /** The solids of the piece for these (effective) values. Pure; never throws for valid values. */
  parts(values: ParamValues, ctx: PieceContext): Part[];
  dimensions(values: ParamValues, ctx: PieceContext): DimensionLine[];
  /**
   * Openings: the piece's own section (without the wall), instead of the generic cut of its parts
   * (`sectionOf` in piece-page/section.ts).
   */
  section?(values: ParamValues, ctx: PieceContext): SectionShape[];
}

/** Identity helper that type-checks a module definition. */
export const definePiece = (module: PieceModule): PieceModule => module;
