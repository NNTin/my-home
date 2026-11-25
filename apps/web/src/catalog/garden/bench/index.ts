import { wood } from '../../cabinet';
import { box, colorParam, numberParam, plank, shade, tilted } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';

const SLAT = 0.025;
const LEG = 0.06;
const LEAN = 0.2;

/**
 * A slatted bench of timber: two leg frames with a rail under the seat, a seat of slats (the
 * grain along them) and a leaning slatted backrest in front of two posts at the back (-z).
 */
export default definePiece({
  id: 'garden.bench',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const seat = Math.min(numberParam(values, 'seat'), h - 0.2);
    const { color, material } = wood(colorParam(values, 'color'));
    const legs = shade(color, -0.15);
    const back = h - seat;
    const lean = Math.sin(LEAN) * back;
    const parts: Part[] = [];
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - LEG);
      parts.push(
        box([x, (seat - SLAT) / 2, d / 2 - LEG], [LEG, seat - SLAT, LEG], legs, 'frame', material),
        box([x, (seat - SLAT) / 2, -d / 2 + LEG], [LEG, seat - SLAT, LEG], legs, 'frame', material),
        box([x, seat - SLAT - 0.03, 0], [LEG * 0.6, 0.06, d - 3 * LEG], legs, 'frame', material),
        tilted(
          box(
            [x, seat + back / 2 - 0.02, -d / 2 + 0.009 - lean / 2],
            [LEG * 0.6, back - 0.02, 0.03],
            legs,
            'frame',
            material,
          ),
          -LEAN,
        ),
      );
    }
    const slats = 4;
    const pitch = (d - 0.04) / slats;
    for (let i = 0; i < slats; i++) {
      const z = -d / 2 + 0.02 + pitch * (i + 0.5);
      parts.push(plank([0, seat - SLAT / 2, z], [w, SLAT, pitch - 0.015], color, 'body', material));
    }
    for (let i = 0; i < 3; i++) {
      const y = seat + 0.08 + ((back - 0.12) * (i + 0.5)) / 3;
      parts.push(
        tilted(
          box(
            [0, y, -d / 2 + 0.03 - (lean * (y - seat)) / back],
            [w, 0.08, SLAT],
            color,
            'body',
            material,
          ),
          -LEAN,
        ),
      );
    }
    return parts;
  },
  dimensions: furnitureDimensions,
});
