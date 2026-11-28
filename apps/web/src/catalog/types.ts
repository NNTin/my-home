import type { ParamValues, TypeId } from '@my-home/shared';
import type { Vec2, Vec3 } from '../geom/types';

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
  /**
   * A finish of the library that may be used on a part (docs/design/realistic-render.md §5.7):
   * `wood.veneer`, `metal.brushed`. The part's colour is its tint (a finish that is not tintable
   * keeps its own), and the finish gives the roughness and metalness: the part's are ignored.
   */
  finish?: string;
  transparent?: boolean;
  opacity?: number;
  depthWrite?: boolean;
  metalness?: number;
  roughness?: number;
  /** Shadows default to on (cast and receive). */
  castShadow?: boolean;
  receiveShadow?: boolean;
}

interface PartBase {
  /** The middle of the part's bounding box. */
  center: Vec3;
  /**
   * The part's bounding box before it is turned: a box's [x, y, z] extents; a cylinder's
   * [diameter, height, diameter], where unequal x/z make it elliptic. The piece page frames the
   * part and cuts its section by this box, whatever the shape.
   */
  size: Vec3;
  rotationY: number;
  /**
   * Optional tilt about the part's own x axis, in radians, applied before `rotationY`: a sloping
   * roof sheet, a leaning backrest, a cylinder lying on its side (π/2). Sections ignore it.
   */
  rotationX?: number;
  color: string;
  material?: PartMaterial;
  role: PartRole;
}

/**
 * What a part is (docs/design/realistic-render.md §8.2); build one with the helpers of
 * `parts.ts`, which work out `center` and `size`.
 * - `box`, `cylinder`: `size` says it all.
 * - `roundedBox`: a box of `size` whose edges and corners are rounded by `radius`.
 * - `extrude`: a closed `profile` in the part's x/y, about `center`, extruded through `size[2]`
 *   and centred on it.
 * - `lathe`: a `profile` of [radius, y] points, y about `center`, turned about the part's y axis.
 *   It runs from the bottom up along the outside; a point given twice is a sharp edge. A profile
 *   that neither starts and ends on the axis nor ends where it starts is an open skin, drawn
 *   from both sides.
 */
export type PartShape =
  | { shape: 'box' | 'cylinder' }
  | { shape: 'roundedBox'; radius: number }
  | { shape: 'extrude' | 'lathe'; profile: Vec2[] };

/** One solid of a piece, in its local frame. */
export type Part = PartBase & PartShape;

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

/**
 * Light a piece emits (docs/design/realistic-render.md §6.4), in its local frame. The viewer lights
 * the nearest emitters with its fixed lamp pool (`lighting/lamps.ts`); the rig scales the intensity.
 */
export interface PieceEmitter {
  /** Where the light comes from: for a recessed light, below its lens. */
  position: Vec3;
  /** `#rrggbb`. */
  color: string;
  /** Candela. */
  intensity: number;
  /** How far the light reaches, in metres; it ends sooner at the bounds of the piece's room. */
  range: number;
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
  /** Placed kinds: the light the piece emits; a piece without it emits none. */
  emits?(values: ParamValues, ctx: PieceContext): PieceEmitter[];
}

/** Identity helper that type-checks a module definition. */
export const definePiece = (module: PieceModule): PieceModule => module;
