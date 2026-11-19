import { BOARD, carcass, uprightHandle } from '../../cabinet';
import { box, colorParam, numberParam, shade } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';

/**
 * A tall cabinet: an open carcass with shelves and one full-height door, smoked glass (push to
 * open: the shelves show through it) or solid with a bar handle.
 */
export default definePiece({
  id: 'kitchen.tall-cabinet',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const body = colorParam(values, 'carcassColor');
    const face = d / 2 - BOARD;
    const parts: Part[] = carcass(w, 0, h, -d / 2, face, body);
    const shelves = Math.max(0, Math.round(numberParam(values, 'shelves')));
    for (let i = 1; i <= shelves; i++) {
      parts.push(
        box(
          [0, (h * i) / (shelves + 1), (face - d / 2) / 2],
          [w - 2 * BOARD, BOARD, face + d / 2 - 0.012],
          shade(body, -0.04),
          'board',
        ),
      );
    }
    const door: [number, number, number] = [w - 0.003, h - 0.003, BOARD];
    if (String(values.door) === 'glass') {
      parts.push(
        box([0, h / 2, d / 2 - BOARD / 2], door, colorParam(values, 'glassColor'), 'glass', {
          transparent: true,
          opacity: numberParam(values, 'glassOpacity'),
          depthWrite: false,
          castShadow: false,
        }),
      );
    } else {
      const front = colorParam(values, 'frontColor');
      parts.push(
        box([0, h / 2, d / 2 - BOARD / 2], door, front, 'leaf'),
        uprightHandle(-w / 2 + 0.04, h / 2, d / 2, 0.3, shade(front, -0.6)),
      );
    }
    return parts;
  },
  dimensions: furnitureDimensions,
});
