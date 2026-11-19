import { BOARD, fittingParts } from '../../cabinet';
import { box, colorParam, numberParam, shade } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../size';

const POST = 0.036;
/** The frame's rails start this far above the floor. */
const FOOT = 0.03;

/** An open wooden frame (corner posts, a top, dividers) with rows and columns of bins. */
export default definePiece({
  id: 'furniture.storage-shelf',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    const bin = colorParam(values, 'binColor');
    const columns = fittingParts(numberParam(values, 'columns'), w, 0.2);
    const rows = fittingParts(numberParam(values, 'rows'), h - FOOT - BOARD, 0.1);
    const parts: Part[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        parts.push(
          box(
            [sx * (w / 2 - POST / 2), h / 2, sz * (d / 2 - POST / 2)],
            [POST, h, POST],
            color,
            'body',
          ),
        );
      }
    }
    parts.push(box([0, h - BOARD / 2, 0], [w, BOARD, d], color, 'board'));
    const cw = (w - 2 * POST) / columns;
    for (let c = 1; c < columns; c++) {
      const x = -w / 2 + POST + cw * c;
      parts.push(box([x, (h + FOOT) / 2, 0], [BOARD, h - FOOT - BOARD, d - 0.01], color, 'board'));
    }
    const ch = (h - FOOT - BOARD) / rows;
    for (let c = 0; c < columns; c++) {
      for (let r = 0; r < rows; r++) {
        const x = -w / 2 + POST + cw * (c + 0.5);
        const y = FOOT + ch * (r + 0.5);
        parts.push(box([x, y, 0.01], [cw - BOARD - 0.012, ch - 0.025, d - 0.05], bin, 'body'));
        parts.push(
          box(
            [x, y + ch / 2 - 0.03, d / 2 - 0.012],
            [cw - BOARD - 0.012, 0.02, 0.012],
            shade(bin, -0.12),
            'detail',
          ),
        );
      }
    }
    return parts;
  },
  dimensions: furnitureDimensions,
});
