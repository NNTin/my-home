import { furnitureSize, type ParamValues } from '@my-home/shared';
import { dimension } from '../parts';
import type { DimensionLine } from '../types';

/** A piece of furniture's size from its effective values (see `furnitureSize`). */
export const sizeOf = furnitureSize;

/**
 * Width along the front edge, depth (a bed's length) along the right side, height up the back
 * right corner.
 */
export function furnitureDimensions(values: ParamValues): DimensionLine[] {
  const { width: w, depth: d, height: h } = furnitureSize(values);
  return [
    dimension([-w / 2, 0, d / 2], [w / 2, 0, d / 2], w, 'Width'),
    dimension([w / 2, 0, d / 2], [w / 2, 0, -d / 2], d, 'length' in values ? 'Length' : 'Depth'),
    dimension([w / 2, 0, -d / 2], [w / 2, h, -d / 2], h, 'Height'),
  ];
}

/** A round piece: the diameter across the front, the height at its right edge. */
export function roundDimensions(values: ParamValues): DimensionLine[] {
  const { width: w, height: h } = furnitureSize(values);
  return [
    dimension([-w / 2, 0, w / 2], [w / 2, 0, w / 2], w, 'Diameter'),
    dimension([w / 2, 0, 0], [w / 2, h, 0], h, 'Height'),
  ];
}
