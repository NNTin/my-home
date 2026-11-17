import { box, colorParam, shade } from '../../parts';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../size';

export default definePiece({
  id: 'furniture.desk',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    const top = 0.04;
    const leg = 0.05;
    return [
      box([0, h - top / 2, 0], [w, top, d], color, 'body'),
      ...[-1, 1].map((side) =>
        box(
          [side * (w / 2 - leg / 2), (h - top) / 2, 0],
          [leg, h - top, d - 0.04],
          shade(color, -0.25),
          'body',
        ),
      ),
    ];
  },
  dimensions: furnitureDimensions,
});
