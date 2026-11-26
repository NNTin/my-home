import { LACQUER } from '../../cabinet';
import { box, colorParam, numberParam, rod } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../size';

/** The square tube of the end frames. */
const TUBE = 0.02;
/** The bars the shoes stand on. */
const BAR = 0.014;
/** The lowest tier's height above the floor. */
const FOOT = 0.06;

/**
 * An open shoe rack: two end frames (a post at the front and at the back, a rail across at every
 * tier) and, at each tier, a bar at the front and one at the back between the frames. The top tier
 * is at the full height; the others are spread evenly down to a little above the floor.
 */
export default definePiece({
  id: 'furniture.shoe-rack',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    const bar = colorParam(values, 'barColor');
    const tiers = Math.max(1, Math.round(numberParam(values, 'tiers')));
    const foot = Math.min(FOOT, h / 2);
    const levels = Array.from({ length: tiers }, (_, i) =>
      tiers === 1 ? h - TUBE / 2 : foot + ((h - TUBE / 2 - foot) * i) / (tiers - 1),
    );
    const parts: Part[] = [];
    for (const side of [-1, 1]) {
      const x = side * (w / 2 - TUBE / 2);
      for (const end of [-1, 1]) {
        parts.push(
          box([x, h / 2, end * (d / 2 - TUBE / 2)], [TUBE, h, TUBE], color, 'frame', LACQUER),
        );
      }
      for (const y of levels) {
        parts.push(box([x, y, 0], [TUBE, TUBE, d - 2 * TUBE], color, 'frame', LACQUER));
      }
    }
    for (const y of levels) {
      for (const end of [-1, 1]) {
        parts.push(
          rod(
            [0, y, end * (d / 2 - TUBE - BAR / 2)],
            BAR,
            w - 2 * TUBE,
            bar,
            'detail',
            'x',
            LACQUER,
          ),
        );
      }
    }
    return parts;
  },
  dimensions: furnitureDimensions,
});
