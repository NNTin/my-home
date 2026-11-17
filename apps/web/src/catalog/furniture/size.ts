import { furnitureSize, type ParamValues } from '@my-home/shared';
import { dimension } from '../parts';
import type { DimensionLine } from '../types';

/** A piece of furniture's size from its effective values (see `furnitureSize`). */
export const sizeOf = furnitureSize;

/** Width along the front edge, depth along the right side, height up the back right corner. */
export function furnitureDimensions(values: ParamValues): DimensionLine[] {
  const { width: w, depth: d, height: h } = furnitureSize(values);
  return [
    dimension([-w / 2, 0, d / 2], [w / 2, 0, d / 2], w),
    dimension([w / 2, 0, d / 2], [w / 2, 0, -d / 2], d),
    dimension([w / 2, 0, -d / 2], [w / 2, h, -d / 2], h),
  ];
}
