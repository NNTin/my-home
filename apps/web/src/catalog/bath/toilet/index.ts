import type { Vec2 } from '../../../geom/types';
import { LACQUER } from '../../cabinet';
import { arc, colorParam, dimension, numberParam, roundedBox, upright } from '../../parts';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';
import { CERAMIC, WHITE } from '../sanitary';

/** The seat with its lid. */
const LID = 0.04;
const PLATE = { width: 0.25, height: 0.165, depth: 0.012 };

/**
 * A wall-hung toilet: the bowl hangs clear of the floor with its back (-z) at the wall, the seat
 * and its lid on top, and the flush plate on the wall above. The origin is the bowl's bottom.
 */
export default definePiece({
  id: 'bath.toilet',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    // Seen from above: straight at the wall, half an ellipse in front.
    const plan = (inset: number, back: number): Vec2[] => {
      const nose = d * 0.45;
      return [
        [w / 2 - inset, -d / 2 + back],
        ...arc([0, 0], 1, 0, Math.PI, 10).map(([c, s]): Vec2 => [
          (w / 2 - inset) * c,
          d / 2 - nose + (nose - inset) * s,
        ]),
        [-w / 2 + inset, -d / 2 + back],
      ];
    };
    return [
      upright(plan(0.02, 0), 0, h - LID, WHITE, 'body', CERAMIC),
      upright(plan(0, 0.07), h - LID, h, '#fbfbf9', 'leaf', LACQUER),
      roundedBox(
        [0, h + numberParam(values, 'plate'), -d / 2 + PLATE.depth / 2],
        [PLATE.width, PLATE.height, PLATE.depth],
        0.006,
        colorParam(values, 'plateColor'),
        'detail',
        LACQUER,
      ),
    ];
  },
  dimensions: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const plate = numberParam(values, 'plate');
    return [
      ...furnitureDimensions(values),
      dimension([-w / 2, h, -d / 2], [-w / 2, h + plate, -d / 2], plate, 'Flush plate'),
    ];
  },
});
