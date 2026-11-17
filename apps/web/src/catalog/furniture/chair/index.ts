import { box, colorParam, shade } from '../../parts';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../size';

export default definePiece({
  id: 'furniture.chair',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    const seat = 0.46;
    const leg = 0.04;
    return [
      box([0, seat, 0], [w, 0.04, d], color, 'body'),
      box(
        [0, seat + (h - seat) / 2, -d / 2 + leg / 2],
        [w, h - seat, leg],
        shade(color, -0.15),
        'body',
      ),
      ...[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sz]) =>
        box(
          [sx! * (w / 2 - leg / 2), seat / 2, sz! * (d / 2 - leg / 2)],
          [leg, seat, leg],
          shade(color, -0.3),
          'body',
        ),
      ),
    ];
  },
  dimensions: furnitureDimensions,
});
