import { box, colorParam } from '../../parts';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';

const LEG = 0.035;
const TOP = 0.012;

/** A patio table: four metal legs, a frame under the edge and a glass top. */
export default definePiece({
  id: 'garden.table',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const frame = colorParam(values, 'frameColor');
    const top = colorParam(values, 'topColor');
    const inset = 0.04;
    const parts = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * (w / 2 - inset);
        const z = sz * (d / 2 - inset);
        parts.push(box([x, (h - TOP) / 2, z], [LEG, h - TOP, LEG], frame, 'frame'));
      }
    }
    parts.push(
      box([0, h - TOP - 0.03, d / 2 - inset], [w - 2 * inset, 0.05, 0.02], frame, 'frame'),
      box([0, h - TOP - 0.03, -d / 2 + inset], [w - 2 * inset, 0.05, 0.02], frame, 'frame'),
      box([0, h - TOP / 2, 0], [w, TOP, d], top, 'glass', {
        transparent: true,
        opacity: 0.6,
        roughness: 0.1,
      }),
    );
    return parts;
  },
  dimensions: furnitureDimensions,
});
