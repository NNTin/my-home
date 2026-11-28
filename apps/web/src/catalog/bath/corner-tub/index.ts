import type { Vec2 } from '../../../geom/types';
import { clamp, LACQUER } from '../../cabinet';
import { arc, colorParam, numberParam, strip, upright } from '../../parts';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';
import { CERAMIC, WHITE, wallSide } from '../sanitary';

/** The apron's thickness, and how far it ends under the rim's top. */
const APRON = 0.02;
const LIP = 0.03;

/**
 * A bathtub in a corner: its back (-z) and one side stand at the walls, and the front is a quarter
 * of an ellipse about that corner. The rim runs along the walls and round the front, the bowl's
 * floor lies `bowl` below it, and the apron (tiles, in its colour) covers the front up to the
 * rim's lip.
 */
export default definePiece({
  id: 'bath.corner-tub',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const wall = wallSide(values);
    const rim = numberParam(values, 'rim');
    const floor = Math.max(0.05, h - numberParam(values, 'bowl'));
    // The corner the tub stands in, and the front `inset` inside the footprint, from the back
    // wall round to the side wall.
    const corner: Vec2 = [(wall * w) / 2, -d / 2];
    const front = (inset: number): Vec2[] =>
      arc([0, 0], 1, 0, Math.PI / 2, 12).map(([c, s]) => [
        corner[0] - wall * (w - inset) * c,
        corner[1] + (d - inset) * s,
      ]);
    const along = APRON + rim / 2;
    // A bar round the front, cut off at the walls: its ends are square to the curve's last
    // chords, which lean a little.
    const round = (inset: number, gauge: number): Vec2[] =>
      strip(front(inset), gauge).map(([x, z]) => [
        clamp(x, -w / 2, w / 2),
        clamp(z, -d / 2, d / 2),
      ]);
    return [
      upright([corner, ...front(along)], floor - 0.02, floor, WHITE, 'body', CERAMIC),
      // The rim along the two walls, then round the front.
      upright(
        strip(
          [
            [corner[0] - wall * (w - APRON), corner[1] + rim / 2],
            [corner[0] - (wall * rim) / 2, corner[1] + rim / 2],
            [corner[0] - (wall * rim) / 2, corner[1] + d - APRON],
          ],
          rim,
        ),
        0,
        h,
        WHITE,
        'body',
        CERAMIC,
      ),
      upright(round(along, rim), 0, h, WHITE, 'body', CERAMIC),
      upright(
        round(APRON / 2, APRON),
        0,
        h - LIP,
        colorParam(values, 'apronColor'),
        'detail',
        LACQUER,
      ),
    ];
  },
  dimensions: furnitureDimensions,
});
