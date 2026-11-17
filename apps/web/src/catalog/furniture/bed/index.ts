import { box, colorParam, shade } from '../../parts';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../size';

export default definePiece({
  id: 'furniture.bed',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    const frame = h * 0.5;
    return [
      box([0, frame / 2, 0], [w, frame, d], color, 'body'),
      box(
        [0, frame + (h - frame) / 2, 0.04],
        [w * 0.96, h - frame, d - 0.12],
        colorParam(values, 'mattressColor'),
        'detail',
      ),
      box([0, h * 0.9, -d / 2 + 0.04], [w, h * 1.8, 0.08], shade(color, -0.2), 'body'),
      ...[-w / 4, w / 4].map((x) =>
        box(
          [x, h + 0.05, -d / 2 + 0.3],
          [w * 0.4, 0.1, 0.35],
          colorParam(values, 'pillowColor'),
          'detail',
        ),
      ),
    ];
  },
  dimensions: furnitureDimensions,
});
