import { BOARD, carcass, GLASS, LACQUER, handle } from '../../cabinet';
import { box, colorParam, numberParam, shade } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';

/** The frame of the glass door: a narrow profile around the pane. */
const DOOR_FRAME = 0.02;

/**
 * A tall cabinet: an open lacquered carcass with shelves and one full-height door, smoked glass
 * in a narrow frame (push to open: the shelves show through it) or solid with a bar handle of
 * brushed metal.
 */
export default definePiece({
  id: 'kitchen.tall-cabinet',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const body = colorParam(values, 'carcassColor');
    const face = d / 2 - BOARD;
    const parts: Part[] = carcass(w, 0, h, -d / 2, face, body, LACQUER);
    const shelves = Math.max(0, Math.round(numberParam(values, 'shelves')));
    for (let i = 1; i <= shelves; i++) {
      parts.push(
        box(
          [0, (h * i) / (shelves + 1), (face - d / 2) / 2],
          [w - 2 * BOARD, BOARD, face + d / 2 - 0.012],
          shade(body, -0.04),
          'board',
          LACQUER,
        ),
      );
    }
    const [dw, dh, z] = [w - 0.003, h - 0.003, d / 2 - BOARD / 2];
    if (String(values.door) === 'glass') {
      const [f, half] = [DOOR_FRAME, DOOR_FRAME / 2];
      const rail = (x: number, y: number, size: [number, number]) =>
        box([x, y, z], [...size, BOARD], body, 'leaf', LACQUER);
      parts.push(
        rail(-dw / 2 + half, h / 2, [f, dh]),
        rail(dw / 2 - half, h / 2, [f, dh]),
        rail(0, h / 2 - dh / 2 + half, [dw - 2 * f, f]),
        rail(0, h / 2 + dh / 2 - half, [dw - 2 * f, f]),
        // The pane last: it is see-through, and drawn over what stands behind it.
        box(
          [0, h / 2, z],
          [dw - 2 * f, dh - 2 * f, 0.006],
          colorParam(values, 'glassColor'),
          'glass',
          {
            ...GLASS,
            transparent: true,
            opacity: numberParam(values, 'glassOpacity'),
            depthWrite: false,
            castShadow: false,
          },
        ),
      );
    } else {
      const front = colorParam(values, 'frontColor');
      parts.push(
        box([0, h / 2, z], [dw, dh, BOARD], front, 'leaf', LACQUER),
        handle(-w / 2 + 0.04, h / 2, d / 2, 0.3, shade(front, -0.6), true),
      );
    }
    return parts;
  },
  dimensions: furnitureDimensions,
});
