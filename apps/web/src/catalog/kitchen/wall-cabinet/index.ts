import { BOARD, doors, fittingParts, LACQUER } from '../../cabinet';
import { box, colorParam, numberParam } from '../../parts';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';

/**
 * A wall cabinet: a lacquered carcass and a row of doors, flat (push to open) or with bar handles
 * of brushed metal near the bottom. Its frame starts at the cabinet's bottom, the back against the
 * wall (-z); the mounting height is the placement's (the type's `elevation` by default).
 */
export default definePiece({
  id: 'kitchen.wall-cabinet',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const count = fittingParts(numberParam(values, 'doors'), w, 0.2);
    const handles = String(values.frontStyle) === 'handle';
    return [
      box(
        [0, h / 2, -BOARD / 2],
        [w, h, d - BOARD],
        colorParam(values, 'carcassColor'),
        'body',
        LACQUER,
      ),
      ...doors(
        count,
        w,
        0,
        h,
        d / 2,
        colorParam(values, 'frontColor'),
        handles ? { color: colorParam(values, 'handleColor'), y: 0.1, length: 0.12 } : undefined,
        LACQUER,
      ),
    ];
  },
  dimensions: furnitureDimensions,
});
