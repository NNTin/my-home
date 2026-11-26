import { FABRIC } from '../../cabinet';
import { colorParam, slab } from '../../parts';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../size';

/** The border's width round the field, at most a fifth of the shorter side. */
const BORDER = 0.04;

/**
 * A rug or a doormat: a woven field inside a border, lying on the floor. The border is a slab of the
 * whole size, the field a slab a little thicker inside it, so the two tops never meet in one plane.
 */
export default definePiece({
  id: 'furniture.rug',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const border = Math.min(BORDER, Math.min(w, d) / 5);
    return [
      slab(
        [0, (h * 0.8) / 2, 0],
        [w, h * 0.8, d],
        0.02,
        colorParam(values, 'borderColor'),
        'body',
        FABRIC,
      ),
      slab(
        [0, h / 2, 0],
        [w - 2 * border, h, d - 2 * border],
        0.01,
        colorParam(values, 'color'),
        'body',
        FABRIC,
      ),
    ];
  },
  dimensions: furnitureDimensions,
});
