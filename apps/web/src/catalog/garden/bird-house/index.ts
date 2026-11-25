import { LACQUER, wood } from '../../cabinet';
import { box, colorParam, dimension, numberParam, rod, shade, tilted } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { sizeOf } from '../../furniture/size';

const HOUSE = 0.32;
const LEG = 0.04;

/**
 * A bird house of timber with a two-tier roof, on a post and a three-legged stand: a floor that
 * stands a little proud, the entrance in its front and a perch under it.
 */
export default definePiece({
  id: 'garden.bird-house',
  parts: (values) => {
    const { height: h } = sizeOf(values);
    const spread = numberParam(values, 'diameter');
    const { color: timber, material } = wood(colorParam(values, 'color'));
    const wall = shade(timber, 0.1);
    const roof = colorParam(values, 'roofColor');
    const house = h - 0.3;
    const legLength = Math.hypot(house * 0.75, spread / 2);
    const lean = Math.atan2(spread / 2, house * 0.75);
    const parts: Part[] = [];
    for (let i = 0; i < 3; i++) {
      const turn = (i / 3) * 2 * Math.PI;
      const leg = tilted(box([0, 0, 0], [LEG, legLength, LEG], timber, 'post', material), lean);
      const reach = spread / 4;
      parts.push({
        ...leg,
        center: [Math.sin(turn) * reach, (house * 0.75) / 2, Math.cos(turn) * reach],
        rotationY: turn + Math.PI,
      });
    }
    parts.push(
      box([0, house / 2, 0], [LEG, house, LEG], timber, 'post', material),
      box([0, house - 0.01, 0], [HOUSE + 0.08, 0.02, HOUSE + 0.08], timber, 'board', material),
      box([0, house + 0.08, 0], [HOUSE, 0.16, HOUSE], wall, 'body', material),
      // The entrance on the front, a dark hole, and the perch under it.
      rod([0, house + 0.1, HOUSE / 2], 0.07, 0.004, shade(timber, -0.75), 'detail', 'z', LACQUER),
      rod([0, house + 0.04, HOUSE / 2 + 0.03], 0.012, 0.06, timber, 'detail', 'z', material),
      box([0, house + 0.17, 0], [HOUSE + 0.12, 0.03, HOUSE + 0.12], roof, 'detail', LACQUER),
      box([0, house + 0.21, 0], [HOUSE * 0.7, 0.05, HOUSE * 0.7], wall, 'body', material),
      box([0, house + 0.25, 0], [HOUSE * 0.85, 0.03, HOUSE * 0.85], roof, 'detail', LACQUER),
      box([0, house + 0.28, 0], [0.05, 0.04, 0.05], roof, 'detail', LACQUER),
    );
    return parts;
  },
  dimensions: (values) => {
    const { height: h } = sizeOf(values);
    const spread = numberParam(values, 'diameter');
    return [
      dimension([-spread / 2, 0, spread / 2], [spread / 2, 0, spread / 2], spread, 'Stand width'),
      dimension([spread / 2, 0, 0], [spread / 2, h, 0], h, 'Height'),
    ];
  },
});
