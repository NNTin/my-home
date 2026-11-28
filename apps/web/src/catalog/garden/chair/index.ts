import type { Vec2 } from '../../../geom/types';
import { FABRIC, METAL } from '../../cabinet';
import { box, colorParam, extrude, numberParam, rod, shade, strip, tilted } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';

const TUBE = 0.025;
const LEAN = 0.18;
/** The armrests lie this far over the seat. */
const ARM = 0.2;

/**
 * A stackable patio chair: on each side a tube bent into the front leg and the armrest, and one
 * that is the back leg and leans back as the backrest's post; cross tubes at the seat and the
 * top; a woven sling for the seat and the high backrest.
 */
export default definePiece({
  id: 'garden.chair',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const seat = Math.min(numberParam(values, 'seat'), h - 0.2);
    const color = colorParam(values, 'color');
    const mesh = shade(color, 0.12);
    const back = h - seat;
    const lean = Math.sin(LEAN) * back;
    const [front, rear] = [d / 2 - TUBE / 2, -d / 2 + TUBE];
    // The side frame seen from the side: the outline's x runs to the chair's front.
    const tubes: Vec2[][] = [
      [
        [front, 0],
        [front, seat + ARM],
        [rear - (lean * ARM) / back, seat + ARM],
      ],
      [
        [rear, 0],
        [rear, seat],
        [rear - lean, h - TUBE / 2],
      ],
    ];
    const parts: Part[] = [];
    for (const side of [-1, 1])
      for (const path of tubes)
        parts.push(
          extrude(
            [side * (w / 2 - TUBE / 2), 0, 0],
            strip(path, TUBE),
            TUBE,
            color,
            'frame',
            -Math.PI / 2,
            METAL,
          ),
        );
    const across = w - 2 * TUBE;
    parts.push(
      rod([0, seat - TUBE / 2, front], TUBE, across, color, 'frame', 'x', METAL),
      rod([0, seat - TUBE / 2, rear], TUBE, across, color, 'frame', 'x', METAL),
      rod([0, h - TUBE / 2, rear - lean], TUBE, across, color, 'frame', 'x', METAL),
      box(
        [0, seat - 0.006, (front + rear) / 2],
        [across, 0.012, front - rear],
        mesh,
        'body',
        FABRIC,
      ),
      tilted(
        box(
          [0, seat + back / 2, rear - lean / 2],
          [across, back - 0.04, 0.012],
          mesh,
          'body',
          FABRIC,
        ),
        -LEAN,
      ),
    );
    return parts;
  },
  dimensions: furnitureDimensions,
});
