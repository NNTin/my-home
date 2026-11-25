import { BOARD, carcass, doors, fittingParts, LACQUER } from '../../cabinet';
import { box, colorParam, numberParam, rod, shade } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../size';

/** A low lacquered cabinet: doors over an open shelf near the floor, round knobs at the doors' top. */
export default definePiece({
  id: 'furniture.shoe-cabinet',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    const shelf = Math.min(numberParam(values, 'shelf'), h / 2);
    const count = fittingParts(numberParam(values, 'doors'), w, 0.2);
    const face = d / 2 - BOARD;
    const parts: Part[] = [
      ...carcass(w, 0, h, -d / 2, face, color, LACQUER),
      box(
        [0, shelf, (face - d / 2) / 2],
        [w - 2 * BOARD, BOARD, face + d / 2],
        shade(color, -0.04),
        'board',
        LACQUER,
      ),
      ...doors(count, w, shelf + BOARD / 2, h, d / 2, color, undefined, LACQUER),
    ];
    const knob = colorParam(values, 'handleColor');
    const dw = w / count;
    for (let i = 0; i < count; i++) {
      const side = count === 1 ? -1 : i < count / 2 ? 1 : -1;
      const x = -w / 2 + dw * (i + 0.5) + side * (dw / 2 - 0.035);
      parts.push(rod([x, h - 0.06, d / 2 + 0.01], 0.022, 0.02, knob, 'handle', 'z', LACQUER));
    }
    return parts;
  },
  dimensions: furnitureDimensions,
});
