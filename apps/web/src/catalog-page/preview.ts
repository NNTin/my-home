import { defaultParams, furnitureSize, type CatalogType, type ParamValues } from '@my-home/shared';
import { pieces } from '../catalog/registry';
import type { Part, PieceContext } from '../catalog/types';

/**
 * Where a type is drawn outside a home: furniture at its own size, an opening in its preview hole
 * (a wall opening also with its sill height, for the piece page's wall stub and dimensions).
 */
export function previewContext(type: CatalogType, values: ParamValues): PieceContext {
  if (type.kind === 'furniture') {
    const { width, height, depth } = furnitureSize(values);
    return { width, height, wallDepth: depth };
  }
  const hole = type.preview ?? { width: 1, height: 1, wallDepth: 0.2 };
  const ctx = { width: hole.width, height: hole.height, wallDepth: hole.wallDepth };
  return type.placement === 'wall' && type.preview ? { ...ctx, sill: type.preview.sill } : ctx;
}

/** The parts of a type with its default values, as the catalogue shows it. */
export function previewParts(type: CatalogType, values = defaultParams(type)): Part[] {
  return pieces.get(type.id)?.parts(values, previewContext(type, values)) ?? [];
}
