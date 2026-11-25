import { FABRIC, LACQUER } from '../../cabinet';
import { box, colorParam, roundedBox, shade, tilted } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../size';

const ARM = 0.18;
const BACK = 0.22;
const FOOT = 0.06;
/** How far a cushion's edges are rounded. */
const SOFT = 0.05;

/**
 * An upholstered sofa on short feet: a base, rounded arms, and a seat and a back cushion for
 * each seat (about 70 cm), the back cushions leaning against the back.
 */
export default definePiece({
  id: 'furniture.sofa',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    const seat = h * 0.5;
    const inner = w - 2 * ARM;
    const seats = Math.max(1, Math.round(inner / 0.7));
    const each = inner / seats;
    const cushion = (center: Part['center'], size: Part['size'], tone = 0) =>
      roundedBox(center, size, SOFT, shade(color, tone), 'body', FABRIC);
    const parts: Part[] = [
      box(
        [0, (FOOT + seat - 0.12) / 2, 0],
        [w - 0.04, seat - 0.12 - FOOT, d - 0.04],
        shade(color, -0.2),
        'body',
        FABRIC,
      ),
      cushion([0, (FOOT + h) / 2, -d / 2 + BACK / 2], [w, h - FOOT, BACK], -0.15),
    ];
    for (const side of [-1, 1]) {
      parts.push(
        cushion(
          [side * (w / 2 - ARM / 2), (FOOT + h * 0.7) / 2, 0],
          [ARM, h * 0.7 - FOOT, d],
          -0.1,
        ),
      );
      for (const z of [-1, 1])
        parts.push(
          box(
            [side * (w / 2 - 0.08), FOOT / 2, z * (d / 2 - 0.08)],
            [0.05, FOOT, 0.05],
            shade(color, -0.7),
            'detail',
            LACQUER,
          ),
        );
    }
    for (let i = 0; i < seats; i++) {
      const x = -inner / 2 + each * (i + 0.5);
      parts.push(
        cushion([x, seat - 0.07, BACK / 2 + 0.01], [each - 0.01, 0.16, d - BACK - 0.02]),
        tilted(
          cushion(
            [x, seat + (h - seat) / 2, -d / 2 + BACK + 0.07],
            [each - 0.02, h - seat - 0.06, 0.14],
            0.05,
          ),
          -0.15,
        ),
      );
    }
    return parts;
  },
  dimensions: furnitureDimensions,
});
