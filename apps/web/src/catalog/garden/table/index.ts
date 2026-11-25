import { GLASS, METAL } from '../../cabinet';
import { box, colorParam, slab } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';

const LEG = 0.035;
const TOP = 0.012;

/** A patio table: four metal legs, a frame under the edge and a glass top with rounded corners. */
export default definePiece({
  id: 'garden.table',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const frame = colorParam(values, 'frameColor');
    const top = colorParam(values, 'topColor');
    const inset = 0.04;
    const [x, z, y] = [w / 2 - inset, d / 2 - inset, h - TOP - 0.025];
    const parts: Part[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1])
        parts.push(
          box([sx * x, (h - TOP) / 2, sz * z], [LEG, h - TOP, LEG], frame, 'frame', METAL),
        );
      parts.push(
        box([0, y, sx * z], [2 * x, 0.05, 0.02], frame, 'frame', METAL),
        box([sx * x, y, 0], [0.02, 0.05, 2 * z], frame, 'frame', METAL),
      );
    }
    parts.push(
      slab([0, h - TOP / 2, 0], [w, TOP, d], 0.03, top, 'glass', {
        ...GLASS,
        transparent: true,
        opacity: 0.6,
      }),
    );
    return parts;
  },
  dimensions: furnitureDimensions,
});
