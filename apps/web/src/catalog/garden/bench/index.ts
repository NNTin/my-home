import { box, colorParam, numberParam, shade, tilted } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';

const SLAT = 0.025;
const LEG = 0.06;
const LEAN = 0.2;

/** A slatted bench: two leg frames, a seat of slats and a leaning slatted backrest at the back (-z). */
export default definePiece({
  id: 'garden.bench',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const seat = Math.min(numberParam(values, 'seat'), h - 0.2);
    const wood = colorParam(values, 'color');
    const legs = shade(wood, -0.15);
    const parts: Part[] = [];
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - LEG);
      parts.push(
        box([x, (seat - SLAT) / 2, d / 2 - LEG], [LEG, seat - SLAT, LEG], legs, 'frame'),
        box([x, (seat - SLAT) / 2, -d / 2 + LEG], [LEG, seat - SLAT, LEG], legs, 'frame'),
      );
    }
    const slats = 4;
    const pitch = (d - 0.04) / slats;
    for (let i = 0; i < slats; i++) {
      const z = -d / 2 + 0.02 + pitch * (i + 0.5);
      parts.push(box([0, seat - SLAT / 2, z], [w, SLAT, pitch - 0.015], wood, 'body'));
    }
    const back = h - seat;
    const lean = Math.sin(LEAN) * back;
    for (let i = 0; i < 3; i++) {
      const y = seat + 0.08 + ((back - 0.12) * (i + 0.5)) / 3;
      parts.push(
        tilted(
          box([0, y, -d / 2 + 0.03 - (lean * (y - seat)) / back], [w, 0.08, SLAT], wood, 'body'),
          -LEAN,
        ),
      );
    }
    return parts;
  },
  dimensions: furnitureDimensions,
});
