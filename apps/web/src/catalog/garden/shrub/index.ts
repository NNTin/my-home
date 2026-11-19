import { colorParam, cylinder, shade } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { roundDimensions, sizeOf } from '../../furniture/size';
import { jitter } from '../random';

/** Slices of a rounded bush: [height fraction of the slice's centre, diameter fraction]. */
const SLICES: [number, number][] = Array.from({ length: 9 }, (_, i) => {
  const y = (i + 0.5) / 9;
  // A sphere squashed at the bottom: narrow where the stems leave the ground.
  return [y, Math.max(0.3, Math.sqrt(1 - (2 * y - 1.1) ** 2))];
});

/** A rounded bush of stacked slices; with roses, flowers dotted over it. */
export default definePiece({
  id: 'garden.shrub',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const leaf = colorParam(values, 'leafColor');
    const slice = h / SLICES.length;
    const parts: Part[] = SLICES.map(([y, r], i) =>
      cylinder([0, y * h, 0], w * r, slice * 1.15, shade(leaf, (i % 3) * 0.04), 'body', d * r),
    );
    if (String(values.flowers) === 'roses') {
      const flower = colorParam(values, 'flowerColor');
      for (let i = 0; i < 14; i++) {
        const [y, r] = SLICES[2 + (i % 6)]!;
        const a = jitter(i) * 2 * Math.PI;
        const x = Math.cos(a) * (w * r) * 0.5;
        const z = Math.sin(a) * (d * r) * 0.5;
        parts.push(
          cylinder([x, y * h + (jitter(i + 50) - 0.5) * slice, z], 0.07, 0.05, flower, 'detail'),
        );
      }
    }
    return parts;
  },
  dimensions: roundDimensions,
});
