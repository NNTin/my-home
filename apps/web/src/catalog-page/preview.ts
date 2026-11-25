import {
  defaultParams,
  furnitureSize,
  isPlacedKind,
  mountingOf,
  type CatalogType,
  type ParamValues,
} from '@my-home/shared';
import { pieces } from '../catalog/registry';
import type { Part, PieceContext } from '../catalog/types';

/**
 * Wall openings on the catalogue and piece pages show their room side to the camera (which looks
 * from +z): the outdoors is -z, so a window's handle, board and curtain face the viewer.
 */
export const ROOM_SIDE_TO_CAMERA = -1 as const;

/**
 * Where a type is drawn outside a home: furniture and fixtures at their own size, an opening in its
 * preview hole (a wall opening also with its sill height, for the piece page's wall stub and
 * dimensions).
 */
export function previewContext(type: CatalogType, values: ParamValues): PieceContext {
  if (isPlacedKind(type)) {
    const { width, height, depth } = furnitureSize(values);
    return { width, height, wallDepth: depth };
  }
  const hole = type.preview ?? { width: 1, height: 1, wallDepth: 0.2 };
  const ctx = { width: hole.width, height: hole.height, wallDepth: hole.wallDepth };
  return type.placement === 'wall' && type.preview
    ? { ...ctx, sill: type.preview.sill, outside: ROOM_SIDE_TO_CAMERA }
    : ctx;
}

/** The parts of a type with its default values, as the catalogue shows it. */
export function previewParts(type: CatalogType, values = defaultParams(type)): Part[] {
  return pieces.get(type.id)?.parts(values, previewContext(type, values)) ?? [];
}

/**
 * The parts a thumbnail draws: the preview, a ceiling piece turned upside down so that the
 * thumbnail's camera (from above) sees the side that faces the room.
 */
export function thumbnailParts(type: CatalogType): Part[] {
  const parts = previewParts(type);
  if (isPlacedKind(type) && mountingOf(type) === 'ceiling') {
    // Half a turn about x: y and z change sign, and so does a turn about y. The part itself is
    // turned over too (its tilt, which comes before the turn, grows by half a turn): a bevelled
    // trim ring is not the same upside down, as a box or a cylinder is.
    return parts.map((p) => ({
      ...p,
      center: [p.center[0], -p.center[1], -p.center[2]],
      rotationY: -p.rotationY,
      rotationX: (p.rotationX ?? 0) + Math.PI,
    }));
  }
  return parts;
}
