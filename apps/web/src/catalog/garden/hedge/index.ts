import { colorParam, roundedBox, shade } from '../../parts';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';
import { jitter } from '../random';

/**
 * A clipped hedge: a row of rounded blocks of leaves, each a little lower or thinner than the
 * hedge's size and reaching into the next, so that the run is straight but not one smooth bar.
 */
export default definePiece({
  id: 'garden.hedge',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const leaf = colorParam(values, 'color');
    // About a metre a block; a long hedge has longer ones, to stay within a piece's triangles.
    const count = Math.min(12, Math.max(1, Math.round(w)));
    const run = w / count;
    return Array.from({ length: count }, (_, i) => {
      // The ends stand at the hedge's ends; inside, a block reaches 8 cm into its neighbours.
      const [from, to] = [i ? i * run - 0.08 : 0, i < count - 1 ? (i + 1) * run + 0.08 : w];
      const high = h * (1 - 0.05 * jitter(i));
      const deep = d * (1 - 0.08 * jitter(i + 20));
      return roundedBox(
        [(from + to - w) / 2, high / 2, 0],
        [to - from, high, deep],
        Math.min(0.12, deep / 3),
        shade(leaf, (i % 3) * 0.04 - 0.04),
        'body',
      );
    });
  },
  dimensions: furnitureDimensions,
});
