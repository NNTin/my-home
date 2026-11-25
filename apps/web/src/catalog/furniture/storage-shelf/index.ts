import { BOARD, fittingParts, LACQUER, wood } from '../../cabinet';
import { box, colorParam, numberParam, shade } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../size';

const POST = 0.036;
/** The frame's rails start this far above the floor. */
const FOOT = 0.03;
/** A bin hangs by its rim on two runners. */
const RUNNER = 0.012;

/**
 * An open wooden frame (corner posts, a top, dividers) with rows and columns of bins. Each bin
 * hangs by its rim on two runners and is narrower below the rim, with a grip in its front.
 */
export default definePiece({
  id: 'furniture.storage-shelf',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const frame = wood(colorParam(values, 'color'));
    const bin = colorParam(values, 'binColor');
    const columns = fittingParts(numberParam(values, 'columns'), w, 0.2);
    const rows = fittingParts(numberParam(values, 'rows'), h - FOOT - BOARD, 0.1);
    const parts: Part[] = [];
    const timber = (center: Part['center'], size: Part['size'], role: Part['role'] = 'board') =>
      parts.push(box(center, size, frame.color, role, frame.material));
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        timber([sx * (w / 2 - POST / 2), h / 2, sz * (d / 2 - POST / 2)], [POST, h, POST], 'body');
    timber([0, h - BOARD / 2, 0], [w, BOARD, d]);
    const cw = (w - 2 * POST) / columns;
    for (let c = 1; c < columns; c++)
      timber([-w / 2 + POST + cw * c, (h + FOOT) / 2, 0], [BOARD, h - FOOT - BOARD, d - 0.01]);
    const ch = (h - FOOT - BOARD) / rows;
    const rim = cw - BOARD - 0.012;
    for (let c = 0; c < columns; c++) {
      for (let r = 0; r < rows; r++) {
        const x = -w / 2 + POST + cw * (c + 0.5);
        const y = FOOT + ch * (r + 0.5);
        const top = y + ch / 2 - 0.0125;
        for (const side of [-1, 1])
          timber(
            [x + side * (cw / 2 - RUNNER / 2 - BOARD / 2), top - 0.014, 0],
            [RUNNER, RUNNER, d - 0.02],
          );
        parts.push(
          box([x, top - 0.004, 0.01], [rim, 0.008, d - 0.05], bin, 'body', LACQUER),
          box([x, y - 0.008, 0.01], [rim - 0.03, ch - 0.041, d - 0.07], bin, 'body', LACQUER),
          box(
            [x, top - 0.03, d / 2 - 0.0245],
            [rim * 0.4, 0.022, 0.002],
            shade(bin, -0.25),
            'detail',
            LACQUER,
          ),
        );
      }
    }
    return parts;
  },
  dimensions: furnitureDimensions,
});
