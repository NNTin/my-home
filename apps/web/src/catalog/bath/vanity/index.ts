import { BOARD, clamp, FRONT_GAP, handle, LACQUER } from '../../cabinet';
import {
  arc,
  box,
  colorParam,
  cylinder,
  dimension,
  extrude,
  numberParam,
  shade,
  slab,
  strip,
} from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';
import { CERAMIC, WHITE } from '../sanitary';

/** How far the drawer fronts stand back under the basin's edge. */
const SETBACK = 0.02;
/** The tap seen from its side: up from the basin, over in a half round, and a little down. */
const TAP = strip([[0, 0], ...arc([0.05, 0.1], 0.05, Math.PI, 0.35, 5)], 0.02);
const CHROME = '#c3c7cb';

/**
 * A wall-hung washbasin cabinet, its back (-z) at the wall and the origin at its bottom: the
 * carcass, its drawer fronts with lying bar handles, and the ceramic basin as its top, with the
 * bowl, the drain and the tap behind it.
 */
export default definePiece({
  id: 'bath.vanity',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    const basin = Math.min(numberParam(values, 'basin'), h / 3);
    const body = h - basin;
    const face = d / 2 - SETBACK;
    const count = clamp(Math.round(numberParam(values, 'drawers')), 1, 3);
    const each = body / count;
    const parts: Part[] = [
      box(
        [0, body / 2, (face - BOARD - d / 2) / 2],
        [w - 0.004, body, face - BOARD + d / 2],
        shade(color, -0.06),
        'body',
        LACQUER,
      ),
    ];
    for (let i = 0; i < count; i++) {
      const y = each * (i + 0.5);
      parts.push(
        box([0, y, face - BOARD / 2], [w - 0.004, each - FRONT_GAP, BOARD], color, 'leaf', LACQUER),
        handle(
          0,
          y + each / 2 - 0.05,
          face,
          Math.min(0.32, w * 0.5),
          colorParam(values, 'handleColor'),
          false,
          LACQUER,
        ),
      );
    }
    const back = -d / 2 + 0.06;
    parts.push(
      slab([0, body + basin / 2, 0], [w, basin, d], 0.015, WHITE, 'body', CERAMIC),
      // The bowl and its drain, drawn on the basin.
      slab([0, h + 0.001, 0.03], [w - 0.12, 0.002, d - 0.2], 0.05, '#dededb', 'detail', LACQUER),
      { ...cylinder([0, h + 0.003, 0.03], 0.045, 0.002, CHROME, 'detail'), material: LACQUER },
      { ...cylinder([0, h + 0.02, back], 0.04, 0.04, CHROME, 'detail'), material: LACQUER },
      extrude([0, h + 0.04, back], TAP, 0.02, CHROME, 'detail', -Math.PI / 2, LACQUER),
    );
    return parts;
  },
  dimensions: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const basin = Math.min(numberParam(values, 'basin'), h / 3);
    return [
      ...furnitureDimensions(values),
      dimension([-w / 2, h - basin, d / 2], [-w / 2, h, d / 2], basin, 'Basin'),
    ];
  },
});
