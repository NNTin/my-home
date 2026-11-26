import { LACQUER } from '../../cabinet';
import { box, colorParam, numberParam } from '../../parts';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';

/**
 * A tiled wall in front of a wall (pipes and a cistern behind it), its back (-z) at that wall,
 * with a top of its own colour to stand things on.
 */
export default definePiece({
  id: 'bath.ledge',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const top = Math.min(numberParam(values, 'top'), h / 2);
    return [
      box([0, (h - top) / 2, 0], [w, h - top, d], colorParam(values, 'color'), 'body', LACQUER),
      box([0, h - top / 2, 0], [w, top, d], colorParam(values, 'topColor'), 'detail', LACQUER),
    ];
  },
  dimensions: furnitureDimensions,
});
