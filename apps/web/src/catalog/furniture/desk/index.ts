import { BOARD, handle, wood } from '../../cabinet';
import { box, colorParam, plank, shade } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../size';

const TOP = 0.03;
/** The drawer pedestal under the right of the top. */
const PEDESTAL = 0.4;

/**
 * A desk: a top with the grain along it on two side panels, a modesty panel at the back, and
 * (where it is wide enough to leave knee room) a pedestal of three drawers on the right.
 */
export default definePiece({
  id: 'furniture.desk',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const { color, material } = wood(colorParam(values, 'color'));
    const dark = shade(color, -0.25);
    const under = h - TOP;
    const parts: Part[] = [
      plank([0, h - TOP / 2, 0], [w, TOP, d], color, 'board', material),
      ...[-1, 1].map((side) =>
        box(
          [side * (w / 2 - BOARD / 2 - 0.01), under / 2, 0],
          [BOARD, under, d - 0.04],
          dark,
          'body',
          material,
        ),
      ),
      box(
        [0, under - 0.18, -d / 2 + 0.05],
        [w - 0.02 - 2 * BOARD, 0.36, BOARD],
        dark,
        'body',
        material,
      ),
    ];
    if (w - PEDESTAL >= 0.75) {
      const x = w / 2 - 0.01 - BOARD - PEDESTAL / 2;
      const [bottom, face] = [0.08, d / 2 - 0.03];
      const drawer = (under - bottom) / 3;
      parts.push(
        box(
          [x, (bottom + under) / 2, -BOARD / 2 - 0.01],
          [PEDESTAL, under - bottom, d - 0.04 - BOARD],
          dark,
          'body',
          material,
        ),
      );
      for (let i = 0; i < 3; i++) {
        const y = bottom + drawer * (i + 0.5);
        parts.push(
          box(
            [x, y, face - BOARD / 2],
            [PEDESTAL - 0.004, drawer - 0.004, BOARD],
            color,
            'leaf',
            material,
          ),
          handle(x, y + drawer / 2 - 0.045, face, 0.16, shade(color, -0.7)),
        );
      }
    }
    return parts;
  },
  dimensions: furnitureDimensions,
});
