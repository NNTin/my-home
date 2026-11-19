import { box, colorParam, numberParam, shade, tilted } from '../../parts';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';

const TUBE = 0.03;
const LEAN = 0.18;

/** A stackable patio chair: a tube frame, a mesh seat and a high, slightly leaning backrest. */
export default definePiece({
  id: 'garden.chair',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const seat = Math.min(numberParam(values, 'seat'), h - 0.2);
    const color = colorParam(values, 'color');
    const mesh = shade(color, 0.12);
    const parts = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * (w / 2 - TUBE);
        const z = sz * (d / 2 - TUBE);
        parts.push(box([x, seat / 2, z], [TUBE, seat, TUBE], color, 'frame'));
      }
    }
    const back = h - seat;
    const lean = Math.sin(LEAN) * back;
    parts.push(
      box([0, seat - 0.015, 0], [w - TUBE, 0.03, d - TUBE], mesh, 'body'),
      tilted(
        box([0, seat + back / 2, -d / 2 + TUBE - lean / 2], [w - TUBE, back, 0.025], mesh, 'body'),
        -LEAN,
      ),
    );
    return parts;
  },
  dimensions: furnitureDimensions,
});
