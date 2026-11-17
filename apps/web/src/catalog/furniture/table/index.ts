import { colorParam, cylinder, shade } from '../../parts';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../size';

/** A round (or oval) top on a single leg and foot. */
export default definePiece({
  id: 'furniture.table',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    const top = 0.04;
    return [
      cylinder([0, h - top / 2, 0], w, top, color, 'body', d),
      cylinder([0, (h - top) / 2, 0], 0.1, h - top, shade(color, -0.3), 'body'),
      cylinder([0, 0.015, 0], 0.5, 0.03, shade(color, -0.3), 'body'),
    ];
  },
  dimensions: furnitureDimensions,
});
