import { box, colorParam, roundedBox, shade } from '../../parts';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';

/** How far the body's edges and corners are rounded. */
const CORNER = 0.012;

/**
 * A freestanding microwave: the body with rounded edges on four feet, the door window on the left of its front and the
 * control panel on the right. It stands on a worktop: its frame starts there (the type's elevation
 * is the worktop height).
 */
export default definePiece({
  id: 'appliance.microwave',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    const foot = 0.01;
    const panel = Math.min(0.12, w * 0.25);
    const face = d / 2;
    return [
      ...[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) =>
          box(
            [sx * (w / 2 - 0.04), foot / 2, sz * (d / 2 - 0.04)],
            [0.03, foot, 0.03],
            shade(color, -0.5),
            'detail',
          ),
        ),
      ),
      roundedBox([0, foot + (h - foot) / 2, 0], [w, h - foot, d], CORNER, color, 'body'),
      box(
        [-panel / 2 - 0.01, foot + (h - foot) / 2, face + 0.002],
        [w - panel - 0.06, (h - foot) * 0.7, 0.004],
        colorParam(values, 'glassColor'),
        'glass',
      ),
      box(
        [w / 2 - panel / 2 - 0.01, foot + (h - foot) / 2, face + 0.002],
        [panel - 0.02, (h - foot) * 0.85, 0.004],
        colorParam(values, 'panelColor'),
        'detail',
      ),
    ];
  },
  dimensions: furnitureDimensions,
});
