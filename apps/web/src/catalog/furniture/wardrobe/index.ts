import { box, colorParam, shade } from '../../parts';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../size';

export default definePiece({
  id: 'furniture.wardrobe',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    return [
      box([0, h / 2, 0], [w, h, d], color, 'body'),
      ...[-1, 1].map((side) =>
        box(
          [side * 0.06, h * 0.55, d / 2 + 0.01],
          [0.02, 0.25, 0.02],
          shade(color, -0.5),
          'detail',
        ),
      ),
      box([0, h / 2, d / 2 + 0.003], [0.01, h * 0.96, 0.005], shade(color, -0.3), 'detail'),
    ];
  },
  dimensions: furnitureDimensions,
});
