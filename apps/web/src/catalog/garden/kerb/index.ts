import { colorParam, extrude } from '../../parts';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';

/** How far the top edges are bevelled, at most a third of the thickness. */
const BEVEL = 0.02;

/** A concrete kerb: its cross-section with both top edges bevelled, run along its length (x). */
export default definePiece({
  id: 'garden.kerb',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const b = Math.min(BEVEL, d / 3, h / 3);
    const section: [number, number][] = [
      [-d / 2, 0],
      [d / 2, 0],
      [d / 2, h - b],
      [d / 2 - b, h],
      [-d / 2 + b, h],
      [-d / 2, h - b],
    ];
    return [extrude([0, 0, 0], section, w, colorParam(values, 'color'), 'body', -Math.PI / 2)];
  },
  dimensions: furnitureDimensions,
});
