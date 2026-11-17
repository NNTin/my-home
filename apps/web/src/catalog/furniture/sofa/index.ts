import { box, colorParam, shade } from '../../parts';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../size';

export default definePiece({
  id: 'furniture.sofa',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    const seat = h * 0.5;
    const arm = 0.18;
    const back = 0.22;
    return [
      box([0, seat / 2, back / 2], [w - 2 * arm, seat, d - back], color, 'body'),
      box([0, h / 2, -d / 2 + back / 2], [w, h, back], shade(color, -0.15), 'body'),
      ...[-1, 1].map((side) =>
        box(
          [side * (w / 2 - arm / 2), (h * 0.7) / 2, 0],
          [arm, h * 0.7, d],
          shade(color, -0.1),
          'body',
        ),
      ),
    ];
  },
  dimensions: furnitureDimensions,
});
