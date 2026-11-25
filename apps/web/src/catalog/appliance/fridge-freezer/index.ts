import { clamp, handle, LACQUER } from '../../cabinet';
import { box, colorParam, dimension, numberParam, roundedBox, shade } from '../../parts';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';

const DOOR = 0.04;
/** The seal between the body and the doors. */
const SEAL = 0.006;
/** The doors end this far over the floor, over a dark kick strip. */
const KICK = 0.04;
/** How far the doors' edges are rounded. */
const EDGE = 0.008;

/**
 * A freestanding fridge-freezer: the body, a dark seal, the fridge door over the freezer door
 * (their edges rounded), a kick strip under them, and bar handles: upright on the fridge door,
 * lying on the freezer's. Steel is drawn as lacquer in its colour (D81).
 */
export default definePiece({
  id: 'appliance.fridge-freezer',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    const bar = colorParam(values, 'handleColor');
    const f = clamp(numberParam(values, 'freezer'), 0.2, h - 0.3);
    const face = d / 2;
    const dark = shade(color, -0.75);
    // The fridge door's handle starts 10 cm over the freezer and ends under the door's top,
    // however low the fridge is.
    const grip = Math.min(0.5, h - f - 0.15);
    const door = (bottom: number, top: number) =>
      roundedBox(
        [0, (bottom + top) / 2, face - DOOR / 2],
        [w - 0.004, top - bottom - 0.006, DOOR],
        EDGE,
        color,
        'leaf',
        LACQUER,
      );
    return [
      box(
        [0, h / 2, -(DOOR + SEAL) / 2],
        [w, h, d - DOOR - SEAL],
        shade(color, -0.12),
        'body',
        LACQUER,
      ),
      box([0, h / 2, face - DOOR - SEAL / 2], [w - 0.02, h - 0.01, SEAL], dark, 'detail', LACQUER),
      box(
        [0, KICK / 2, face - DOOR / 2 - 0.01],
        [w - 0.03, KICK, DOOR - 0.02],
        dark,
        'detail',
        LACQUER,
      ),
      door(f, h),
      door(KICK, f),
      handle(w / 2 - 0.05, f + 0.1 + grip / 2, face, grip, bar, true, LACQUER),
      handle(0, f - 0.06, face, w * 0.6, bar, false, LACQUER),
    ];
  },
  dimensions: (values) => {
    const { width: w, depth: d } = sizeOf(values);
    const f = clamp(numberParam(values, 'freezer'), 0.2, sizeOf(values).height - 0.3);
    return [
      ...furnitureDimensions(values),
      dimension([-w / 2, 0, d / 2], [-w / 2, f, d / 2], f, 'Freezer door'),
    ];
  },
});
