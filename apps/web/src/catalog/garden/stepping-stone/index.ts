import { colorParam, lathe } from '../../parts';
import { definePiece } from '../../types';
import { roundDimensions, sizeOf } from '../../furniture/size';

/** A round slab lying in the lawn, its top just above the grass and its upper edge worn round. */
export default definePiece({
  id: 'garden.stepping-stone',
  parts: (values) => {
    const { width: w, height: h } = sizeOf(values);
    const [r, worn] = [w / 2, Math.min(h * 0.6, 0.02)];
    return [
      lathe(
        [0, 0, 0],
        [
          [0, 0],
          [r, 0],
          [r, h - worn],
          [r - worn * 0.4, h - worn * 0.3],
          [r - worn * 1.2, h],
          [0, h],
        ],
        colorParam(values, 'color'),
        'body',
      ),
    ];
  },
  dimensions: roundDimensions,
});
