import { colorParam, dimension, numberParam, rod, shade } from '../../parts';
import { definePiece } from '../../types';
import { sizeOf } from '../../furniture/size';

const CUT = '#c9ad84';
/** The cut at an end, from the outside in: [share of the diameter, colour]. */
const RINGS: [number, number][] = [
  [0.9, 0],
  [0.55, -0.14],
  [0.12, -0.4],
];

/**
 * A tree trunk section lying along its width: the bark, and at both ends the cut wood inside it,
 * with its darker heartwood and the pith.
 */
export default definePiece({
  id: 'garden.log',
  parts: (values) => {
    const { width: length } = sizeOf(values);
    const diameter = numberParam(values, 'diameter');
    const y = diameter / 2;
    return [
      rod([0, y, 0], diameter, length - 0.006, colorParam(values, 'color'), 'body'),
      ...[-1, 1].flatMap((side) =>
        RINGS.map(([share, tone], i) =>
          // Each ring a millimetre proud of the one around it.
          rod(
            [side * (length / 2 - 0.006 - (RINGS.length - 1 - i) * 0.001), y, 0],
            diameter * share,
            0.012,
            shade(CUT, tone),
            'detail',
          ),
        ),
      ),
    ];
  },
  dimensions: (values) => {
    const { width: length } = sizeOf(values);
    const diameter = numberParam(values, 'diameter');
    return [
      dimension([-length / 2, 0, diameter / 2], [length / 2, 0, diameter / 2], length, 'Length'),
      dimension([length / 2, 0, 0], [length / 2, diameter, 0], diameter, 'Diameter'),
    ];
  },
});
