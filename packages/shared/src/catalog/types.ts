import type { OpeningType } from '../home-model';
import type { CatalogKind, TypeId } from './ids';
import type { ParamSpec } from './params';

/** Where a piece sits: in a wall (or an outbuilding edge), a roof plane, a fence line or on a floor. */
export type Placement = 'wall' | 'roof' | 'fence' | 'floor';

/**
 * A catalogue type: one kind of piece (a casement window, a bed) with its metadata and parameters.
 * Uses refer to it by `id`; the design (geometry) lives with the type, a use only stores the
 * basic parameters it changes.
 */
export interface CatalogType {
  id: TypeId;
  kind: CatalogKind;
  family: 'window' | 'door' | 'gate' | 'furniture';
  name: string;
  description: string;
  icon: string;
  /** Furniture: "Bed room", "Dining", … (the groups of the furniture catalogue panel). */
  category?: string;
  placement: Placement;
  /** Wall openings: the home model `Opening.type` values this type may carry. */
  openingTypes?: readonly OpeningType[];
  /** The hole used by the piece page's preview when there is no real use (openings). */
  preview?: { width: number; height: number; sill: number; wallDepth: number };
  params: Readonly<Record<string, ParamSpec>>;
  /** Furniture: how it snaps to walls. */
  snapping?: { wall: 'back' | 'any' | 'none' };
  /** Furniture; derived from the effective width/depth (rectangle when omitted). */
  footprint?: 'rectangle' | 'ellipse';
}

/** Identity helper that type-checks a definition; `catalog` validates it at import. */
export const defineType = (type: CatalogType): CatalogType => type;
