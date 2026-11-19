import { box, colorParam, cylinder, numberParam, shade } from '../../parts';
import { definePiece } from '../../types';
import { dimension } from '../../parts';
import { sizeOf } from '../../furniture/size';

/** A round or square pot with a plant growing out of it. */
export default definePiece({
  id: 'garden.planter',
  parts: (values) => {
    const { width: w, height: h } = sizeOf(values);
    const plant = numberParam(values, 'plantHeight');
    const pot = colorParam(values, 'color');
    const leaves = colorParam(values, 'plantColor');
    const square = String(values.shape) === 'square';
    const parts = [
      square
        ? box([0, h / 2, 0], [w, h, w], pot, 'body')
        : cylinder([0, h / 2, 0], w, h, pot, 'body'),
      square
        ? box([0, h - 0.01, 0], [w - 0.04, 0.02, w - 0.04], shade(pot, -0.45), 'detail')
        : cylinder([0, h - 0.01, 0], w - 0.04, 0.02, shade(pot, -0.45), 'detail'),
    ];
    if (plant > 0) {
      parts.push(
        cylinder([0, h + plant * 0.35, 0], w * 0.8, plant * 0.7, leaves, 'body'),
        cylinder([0, h + plant * 0.85, 0], w * 0.55, plant * 0.3, shade(leaves, 0.15), 'detail'),
      );
    }
    return parts;
  },
  dimensions: (values) => {
    const { width: w, height: h } = sizeOf(values);
    const plant = numberParam(values, 'plantHeight');
    return [
      dimension([-w / 2, 0, w / 2], [w / 2, 0, w / 2], w, 'Diameter'),
      dimension([w / 2, 0, 0], [w / 2, h, 0], h, 'Pot height'),
      dimension([w / 2, h, 0], [w / 2, h + plant, 0], plant, 'Plant height'),
    ];
  },
});
