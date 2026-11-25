import { LACQUER, wood } from '../../cabinet';
import { colorParam, cylinder, lathe, shade } from '../../parts';
import { definePiece } from '../../types';
import { roundDimensions, sizeOf } from '../size';

const TOP = 0.04;

/**
 * A round top on a turned pedestal: a wide foot, a column that swells in its lower half, and a
 * plate under the top. The top is oak veneer stained to its colour, or lacquer for a colour
 * lighter than oak; the pedestal is lacquered (a grain does not go round a turning).
 */
export default definePiece({
  id: 'furniture.table',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    const top = wood(color);
    const under = h - TOP;
    return [
      {
        ...cylinder([0, h - TOP / 2, 0], w, TOP, top.color, 'body', d),
        material: top.material,
      },
      lathe(
        [0, 0, 0],
        [
          [0, 0],
          [0.25, 0],
          [0.25, 0.02],
          [0.08, 0.05],
          [0.045, 0.12],
          [0.07, under * 0.3],
          [0.04, under * 0.55],
          [0.04, under - 0.04],
          [0.14, under - 0.02],
          [0.14, under],
          [0, under],
        ],
        shade(color, -0.3),
        'body',
        LACQUER,
      ),
    ];
  },
  dimensions: roundDimensions,
});
