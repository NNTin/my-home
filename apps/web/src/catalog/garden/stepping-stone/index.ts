import { colorParam, cylinder } from '../../parts';
import { definePiece } from '../../types';
import { roundDimensions, sizeOf } from '../../furniture/size';

/** A round slab lying in the lawn, its top just above the grass. */
export default definePiece({
  id: 'garden.stepping-stone',
  parts: (values) => {
    const { width: w, height: h } = sizeOf(values);
    return [cylinder([0, h / 2, 0], w, h, colorParam(values, 'color'), 'body')];
  },
  dimensions: roundDimensions,
});
