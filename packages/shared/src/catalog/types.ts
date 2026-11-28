import type { OpeningType } from './opening-type';
import type { CatalogKind, TypeId } from './ids';
import type { ParamSpec } from './params';

/**
 * Where a piece sits: in a wall (or an outbuilding edge), a roof plane, a fence line, or placed
 * (`floor`: a database placement on a level, in a room or, outdoor pieces, on the ground outside;
 * `mounting` says on what it hangs there).
 * (Called `Placement` until #39, which gave that name to the stored furniture placement record.)
 */
export type PlacementKind = 'wall' | 'roof' | 'fence' | 'floor';

/** What a piece placed in a room is fixed to: it stands on the floor, hangs on a wall or the ceiling. */
export type Mounting = 'floor' | 'wall' | 'ceiling';

/** The families: the first part of a type id, and the folder of its piece module. */
export type CatalogFamily =
  | 'window'
  | 'door'
  | 'gate'
  | 'furniture'
  | 'kitchen'
  | 'appliance'
  | 'bath'
  | 'fixture'
  | 'garden';

/**
 * A catalogue type: one kind of piece (a casement window, a bed) with its metadata and parameters.
 * Uses refer to it by `id`; the design (geometry) lives with the type, a use only stores the
 * basic parameters it changes.
 */
export interface CatalogType {
  id: TypeId;
  kind: CatalogKind;
  family: CatalogFamily;
  name: string;
  description: string;
  icon: string;
  /**
   * Furniture and fixtures: "Bed room", "Kitchen", "Lighting", … (the groups of the catalogue and
   * of the furniture panel).
   */
  category?: string;
  placement: PlacementKind;
  /**
   * Placed kinds (`placement: 'floor'`): what the piece is fixed to (`floor` when omitted). Its local
   * frame starts at that surface: the floor or a wall cabinet's bottom (the back at -depth / 2), the
   * ceiling for a ceiling piece (which hangs down, -y).
   */
  mounting?: Mounting;
  /**
   * Placed kinds: the default height of the piece's bottom above the floor, in metres: a wall
   * cabinet's, or a microwave's on the worktop. 0 when omitted; ceiling pieces have none.
   */
  elevation?: number;
  /** Wall openings: the home model `Opening.type` values this type may carry. */
  openingTypes?: readonly OpeningType[];
  /** The hole used by the piece page's preview when there is no real use (openings). */
  preview?: { width: number; height: number; sill: number; wallDepth: number };
  params: Readonly<Record<string, ParamSpec>>;
  /** Furniture: how it snaps to walls. */
  snapping?: { wall: 'back' | 'any' | 'none' };
  /**
   * Furniture; derived from the effective width/depth (rectangle when omitted). `none`: the piece
   * takes no floor space (an open pergola you sit under, a stepping stone you walk over): it
   * collides with nothing and never blocks the walking figure.
   */
  footprint?: 'rectangle' | 'ellipse' | 'none';
}

/** Kinds placed as database placements: furniture and fixtures in rooms, outdoor pieces outside. */
export const isPlacedKind = (type: Pick<CatalogType, 'kind'>): boolean =>
  type.kind === 'furniture' || type.kind === 'fixtures' || type.kind === 'outdoor';

/**
 * Outdoor pieces (the garden family) stand on the ground where they are placed, the terrain's
 * surface there, not on their level's floor.
 */
export const isOutdoorKind = (type: Pick<CatalogType, 'kind'>): boolean => type.kind === 'outdoor';

export const mountingOf = (type: Pick<CatalogType, 'mounting'>): Mounting =>
  type.mounting ?? 'floor';

/** Identity helper that type-checks a definition; `catalog` validates it at import. */
export const defineType = (type: CatalogType): CatalogType => type;
