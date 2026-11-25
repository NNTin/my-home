import { BOARD, doors, LACQUER, wood } from '../../cabinet';
import { box, colorParam, shade } from '../../parts';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../size';

/** The plinth under the doors, standing back from them. */
const PLINTH = 0.06;

/**
 * A wardrobe: the carcass on a plinth, under a top that stands a little proud, and pairs of doors
 * (one pair for each 1.2 m of width, at least one) with bar handles where each pair meets.
 */
export default definePiece({
  id: 'furniture.wardrobe',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    const { color: tone, material } = wood(color);
    const dark = shade(color, -0.5);
    const face = d / 2 - 0.004;
    return [
      box([0, PLINTH / 2, -0.02], [w - 0.02, PLINTH, d - 0.06], dark, 'body', LACQUER),
      box(
        [0, (PLINTH + h - BOARD) / 2, -(BOARD + 0.004) / 2],
        [w, h - BOARD - PLINTH, d - BOARD - 0.004],
        shade(tone, -0.08),
        'body',
        material,
      ),
      box([0, h - BOARD / 2, 0], [w, BOARD, d], tone, 'board', material),
      ...doors(
        2 * Math.max(1, Math.round(w / 1.2)),
        w,
        PLINTH,
        h - BOARD,
        face,
        tone,
        { color: dark, y: h * 0.52, length: 0.25 },
        material,
      ),
    ];
  },
  dimensions: furnitureDimensions,
});
