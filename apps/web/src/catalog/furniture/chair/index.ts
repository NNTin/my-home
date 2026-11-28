import type { Vec2 } from '../../../geom/types';
import { wood } from '../../cabinet';
import { box, colorParam, extrude, shade, slab, strip, tilted } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../size';

const SEAT = 0.46;
const LEG = 0.036;
/** The back posts lean this far back at the top. */
const RAKE = 0.045;

/**
 * A wooden chair: a seat with rounded corners on a frame of rails, straight front legs, and back
 * legs that run on as the backrest's posts, leaning back, with two rails between them.
 */
export default definePiece({
  id: 'furniture.chair',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const { color, material } = wood(colorParam(values, 'color'));
    const frame = shade(color, -0.2);
    const [x, front, rear] = [w / 2 - LEG / 2, d / 2 - LEG / 2, -d / 2 + RAKE + LEG / 2];
    // A back leg and its post seen from the side: the outline's x runs to the chair's front.
    const post: Vec2[] = [
      [rear, 0],
      [rear, SEAT],
      [rear - RAKE, h - 0.003],
    ];
    const lean = Math.atan2(RAKE, h - SEAT);
    const parts: Part[] = [];
    for (const side of [-1, 1]) {
      parts.push(
        extrude([side * x, 0, 0], strip(post, LEG), LEG, frame, 'body', -Math.PI / 2, material),
        box([side * x, (SEAT - 0.02) / 2, front], [LEG, SEAT - 0.02, LEG], frame, 'body', material),
        box(
          [side * x, SEAT - 0.045, (front + rear) / 2],
          [0.02, 0.05, front - rear],
          frame,
          'body',
          material,
        ),
      );
    }
    parts.push(
      box([0, SEAT - 0.045, front], [2 * x, 0.05, 0.02], frame, 'body', material),
      slab(
        [0, SEAT - 0.01, (d / 2 + rear - LEG / 2) / 2],
        [w, 0.02, d / 2 - rear + LEG / 2],
        0.03,
        color,
        'body',
        material,
      ),
      ...[0.45, 0.85].map((up) =>
        tilted(
          box(
            [0, SEAT + (h - SEAT) * up, rear - RAKE * up],
            [2 * x - LEG, up > 0.5 ? 0.09 : 0.05, 0.018],
            color,
            'body',
            material,
          ),
          -lean,
        ),
      ),
    );
    return parts;
  },
  dimensions: furnitureDimensions,
});
