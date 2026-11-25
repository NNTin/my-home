import { FABRIC, wood } from '../../cabinet';
import { box, colorParam, roundedBox, shade } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../size';

const RAIL = 0.03;
const HEADBOARD = 0.08;

/**
 * A bed: a wooden frame on legs (side rails, a foot rail and a headboard at the back), a mattress
 * with rounded edges, two pillows at the head and a duvet over the rest. `height` is the top of
 * the mattress; the headboard is 1.8 times as high.
 */
export default definePiece({
  id: 'furniture.bed',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const { color, material } = wood(colorParam(values, 'color'));
    const dark = shade(color, -0.2);
    const linen = colorParam(values, 'mattressColor');
    const frame = h * 0.5;
    const soft = (center: Part['center'], size: Part['size'], radius: number, tone: string) =>
      roundedBox(center, size, radius, tone, 'detail', FABRIC);
    const timber = (center: Part['center'], size: Part['size'], tone = color) =>
      box(center, size, tone, 'body', material);
    const lying = d - HEADBOARD;
    const z = HEADBOARD / 2;
    return [
      timber([0, h * 0.9, -d / 2 + HEADBOARD / 2], [w, h * 1.8, HEADBOARD], dark),
      ...[-1, 1].map((side) =>
        timber([side * (w / 2 - RAIL / 2), frame - 0.09, z], [RAIL, 0.18, lying]),
      ),
      timber([0, frame - 0.09, d / 2 - RAIL / 2], [w - 2 * RAIL, 0.18, RAIL]),
      timber([0, frame - 0.055, z], [w - 2 * RAIL, 0.03, lying - RAIL], dark),
      ...[-1, 1].map((side) =>
        timber(
          [side * (w / 2 - 0.03), (frame - 0.18) / 2, d / 2 - 0.03],
          [0.06, frame - 0.18, 0.06],
          dark,
        ),
      ),
      soft(
        // From the headboard's face to the foot rail.
        [0, (frame + h) / 2 - 0.02, z - RAIL / 2],
        [w - 2 * RAIL - 0.01, h - frame + 0.04, lying - RAIL],
        0.05,
        linen,
      ),
      ...[-w / 4, w / 4].map((x) =>
        soft(
          [x, h + 0.05, -d / 2 + 0.3],
          [w * 0.4, 0.1, 0.35],
          0.05,
          colorParam(values, 'pillowColor'),
        ),
      ),
      // The duvet lies over the mattress from where the pillows end to the foot, and hangs over
      // its sides.
      soft([0, h - 0.03, z + 0.1925], [w - 0.02, 0.14, lying - 0.405], 0.06, shade(linen, -0.07)),
    ];
  },
  dimensions: furnitureDimensions,
});
