import { box, colorParam, dimension, numberParam } from '../../parts';
import { definePiece } from '../../types';

const CAP = 0.08;
const CAP_OVER = 0.03;

/** A square brick pillar under a concrete cap that overhangs it on every side. */
export default definePiece({
  id: 'garden.pillar',
  parts: (values) => {
    const w = numberParam(values, 'diameter');
    const h = numberParam(values, 'height');
    const shaft = h - CAP;
    return [
      box([0, shaft / 2, 0], [w, shaft, w], colorParam(values, 'color'), 'body'),
      box(
        [0, shaft + CAP / 2, 0],
        [w + 2 * CAP_OVER, CAP, w + 2 * CAP_OVER],
        colorParam(values, 'capColor'),
        'detail',
      ),
    ];
  },
  dimensions: (values) => {
    const w = numberParam(values, 'diameter');
    const h = numberParam(values, 'height');
    return [
      dimension([-w / 2, 0, w / 2], [w / 2, 0, w / 2], w, 'Width'),
      dimension([w / 2, 0, w / 2], [w / 2, h, w / 2], h, 'Height'),
    ];
  },
});
