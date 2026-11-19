import { box, colorParam, dimension, numberParam, shade, tilted } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { sizeOf } from '../../furniture/size';

const HOUSE = 0.32;
const LEG = 0.04;

/** A bird house with a two-tier roof on a post and a three-legged stand. */
export default definePiece({
  id: 'garden.bird-house',
  parts: (values) => {
    const { height: h } = sizeOf(values);
    const spread = numberParam(values, 'diameter');
    const wood = colorParam(values, 'color');
    const roof = colorParam(values, 'roofColor');
    const house = h - 0.3;
    const legLength = Math.hypot(house * 0.75, spread / 2);
    const lean = Math.atan2(spread / 2, house * 0.75);
    const parts: Part[] = [];
    for (let i = 0; i < 3; i++) {
      const turn = (i / 3) * 2 * Math.PI;
      const leg = tilted(box([0, 0, 0], [LEG, legLength, LEG], wood, 'post'), lean);
      const reach = spread / 4;
      parts.push({
        ...leg,
        center: [Math.sin(turn) * reach, (house * 0.75) / 2, Math.cos(turn) * reach],
        rotationY: turn + Math.PI,
      });
    }
    parts.push(
      box([0, house / 2, 0], [LEG, house, LEG], wood, 'post'),
      box([0, house + 0.08, 0], [HOUSE, 0.16, HOUSE], shade(wood, 0.1), 'body'),
      box([0, house + 0.17, 0], [HOUSE + 0.12, 0.03, HOUSE + 0.12], roof, 'detail'),
      box([0, house + 0.21, 0], [HOUSE * 0.7, 0.05, HOUSE * 0.7], shade(wood, 0.1), 'body'),
      box([0, house + 0.25, 0], [HOUSE * 0.85, 0.03, HOUSE * 0.85], roof, 'detail'),
      box([0, house + 0.28, 0], [0.05, 0.04, 0.05], roof, 'detail'),
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
