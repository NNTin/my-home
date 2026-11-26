import { LACQUER } from '../../cabinet';
import { box, colorParam, extrude, rod, shade } from '../../parts';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';

const WHEEL = 0.2;
const LID = 0.04;
/** The body narrows by this much towards its foot, at the front and at the back. */
const TAPER = 0.05;

/**
 * A wheelie bin: a body that narrows to its foot, a lid that overhangs it a little, two wheels
 * and a handle at the back (-z), where the lid is hinged.
 */
export default definePiece({
  id: 'garden.bin',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    const wheel = colorParam(values, 'wheelColor');
    const top = h - LID;
    const [front, back] = [d / 2 - 0.02, -d / 2 + 0.04];
    // The body's side view (z along x, y up), extruded across the width.
    const side: [number, number][] = [
      [back + TAPER, 0.04],
      [front - TAPER, 0.04],
      [front, top],
      [back, top],
    ];
    return [
      extrude([0, 0, 0], side, w - 0.02, color, 'body', -Math.PI / 2, LACQUER),
      box([0, top + LID / 2, 0.01], [w, LID, d - 0.02], shade(color, 0.08), 'detail', LACQUER),
      rod(
        [0, top - 0.02, -d / 2 + 0.01],
        0.03,
        w - 0.06,
        shade(color, -0.2),
        'handle',
        'x',
        LACQUER,
      ),
      rod([0, WHEEL / 2, back + 0.02], 0.025, w - 0.04, shade(wheel, 0.2), 'detail', 'x', LACQUER),
      ...[-1, 1].map((side) =>
        rod(
          [(side * (w - 0.08)) / 2, WHEEL / 2, back + 0.02],
          WHEEL,
          0.06,
          wheel,
          'detail',
          'x',
          LACQUER,
        ),
      ),
    ];
  },
  dimensions: furnitureDimensions,
});
