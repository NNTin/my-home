import { GLASS, LACQUER } from '../../cabinet';
import { box, colorParam, rod, roundedBox, shade } from '../../parts';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';

/** How far the body's edges and corners are rounded. */
const CORNER = 0.012;

/**
 * A freestanding microwave: the body with rounded edges on four feet, the door's glass window on
 * the left of its front and the control panel on the right, with a display, three rows of keys and
 * a dial. It stands on a worktop: its frame starts there (the type's elevation is the worktop
 * height).
 */
export default definePiece({
  id: 'appliance.microwave',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    const control = colorParam(values, 'panelColor');
    const foot = 0.01;
    const panel = Math.min(0.12, w * 0.25);
    const face = d / 2;
    const px = w / 2 - panel / 2 - 0.01;
    const [bottom, tall] = [foot + (h - foot) * 0.075, (h - foot) * 0.85];
    const key = shade(control, 0.35);
    return [
      ...[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) =>
          box(
            [sx * (w / 2 - 0.04), foot / 2, sz * (d / 2 - 0.04)],
            [0.03, foot, 0.03],
            shade(color, -0.5),
            'detail',
            LACQUER,
          ),
        ),
      ),
      roundedBox([0, foot + (h - foot) / 2, 0], [w, h - foot, d], CORNER, color, 'body', LACQUER),
      box(
        [-panel / 2 - 0.01, foot + (h - foot) / 2, face + 0.002],
        [w - panel - 0.06, (h - foot) * 0.7, 0.004],
        colorParam(values, 'glassColor'),
        'glass',
        GLASS,
      ),
      box(
        [px, bottom + tall / 2, face + 0.002],
        [panel - 0.02, tall, 0.004],
        control,
        'detail',
        LACQUER,
      ),
      // From the top of the panel down: the display, the keys, the dial.
      box(
        [px, bottom + tall * 0.88, face + 0.0045],
        [panel - 0.04, tall * 0.13, 0.001],
        shade(control, -0.8),
        'detail',
        GLASS,
      ),
      ...[0.7, 0.6, 0.5].map((at) =>
        box(
          [px, bottom + tall * at, face + 0.005],
          [panel - 0.04, tall * 0.05, 0.002],
          key,
          'detail',
          LACQUER,
        ),
      ),
      rod(
        [px, bottom + tall * 0.22, face + 0.011],
        Math.min(0.05, panel - 0.04),
        0.014,
        key,
        'handle',
        'z',
        LACQUER,
      ),
    ];
  },
  dimensions: furnitureDimensions,
});
