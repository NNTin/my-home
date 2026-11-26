import { GLASS, LACQUER } from '../../cabinet';
import { box, colorParam, rod, roundedBox, shade } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';

/** From this height on the piece is two machines: a dryer on the washing machine. */
export const COLUMN_FROM = 1.2;
/** How far the door and the controls stand in front of the body. */
const FRONT = 0.02;

/**
 * A front loader: the body on its feet, the control panel with its display and dial, and the
 * round door, a dark ring around its glass. From 1.2 m of height two of them stand on each
 * other, the dryer on the washing machine.
 */
export default definePiece({
  id: 'appliance.washing-machine',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    const dark = colorParam(values, 'doorColor');
    const count = h >= COLUMN_FROM ? 2 : 1;
    const each = h / count;
    const face = d / 2 - FRONT;
    const door = Math.min(w - 0.12, each - 0.36);
    const parts: Part[] = [];
    for (let i = 0; i < count; i++) {
      const y = i * each;
      parts.push(
        // On its feet, or on the machine below: 1 cm shows between them.
        box(
          [0, y + 0.005, -FRONT / 2],
          [w - 0.06, 0.01, d - FRONT - 0.06],
          dark,
          'detail',
          LACQUER,
        ),
        roundedBox(
          [0, y + 0.01 + (each - 0.01) / 2, -FRONT / 2],
          [w, each - 0.01, d - FRONT],
          0.012,
          color,
          'body',
          LACQUER,
        ),
        box(
          [0, y + each - 0.07, face + 0.003],
          [w - 0.02, 0.1, 0.006],
          shade(color, -0.05),
          'detail',
          LACQUER,
        ),
        box(
          [w * 0.22, y + each - 0.07, face + 0.008],
          [w * 0.32, 0.05, 0.004],
          dark,
          'glass',
          GLASS,
        ),
        rod([-w * 0.08, y + each - 0.07, face + 0.012], 0.06, 0.024, color, 'handle', 'z', LACQUER),
        rod([0, y + (each - 0.12) / 2, face + 0.008], door, 0.016, dark, 'leaf', 'z', LACQUER),
        rod(
          [0, y + (each - 0.12) / 2, face + 0.012],
          door * 0.66,
          0.016,
          '#3a3f45',
          'glass',
          'z',
          GLASS,
        ),
      );
    }
    return parts;
  },
  dimensions: furnitureDimensions,
});
