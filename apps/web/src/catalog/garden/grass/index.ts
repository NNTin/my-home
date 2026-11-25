import type { Vec2 } from '../../../builder/buildHome';
import { colorParam, cylinder, extrude, shade } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { roundDimensions, sizeOf } from '../../furniture/size';
import { jitter } from '../random';

const BLADES = 24;

/** A blade seen flat: 4 cm wide at its foot, tapering to its tip. */
const blade = (length: number): Vec2[] => [
  [-0.02, 0],
  [0.02, 0],
  [0.003, length],
  [-0.003, length],
];

/**
 * A clump of tall grass: a dense base and tapering blades that fan out from it, the outer ones
 * leaning more and the longest standing in the middle.
 */
export default definePiece({
  id: 'garden.grass',
  parts: (values) => {
    const { width: w, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    const parts: Part[] = [
      cylinder([0, h * 0.08, 0], w * 0.4, h * 0.16, shade(color, -0.25), 'body'),
    ];
    const fan = Math.atan2(w / 2, h);
    for (let i = 0; i < BLADES; i++) {
      const turn = ((i + jitter(i) * 0.5) / BLADES) * 6 * Math.PI;
      // The first stands upright at full height; the others lean out, the more the shorter.
      const lean = i === 0 ? 0 : fan * (0.25 + 0.75 * jitter(i + 30));
      const length = i === 0 ? h : h * (1 - 0.45 * (lean / fan) * (0.6 + 0.4 * jitter(i + 60)));
      const [c, s] = [Math.cos(turn), Math.sin(turn)];
      const reach = (Math.sin(lean) * length) / 2;
      parts.push({
        ...extrude([0, 0, 0], blade(length), 0.004, shade(color, (i % 4) * 0.05 - 0.05), 'detail'),
        // Lean outwards, then turn the blade round the clump.
        rotationX: lean,
        rotationY: turn,
        center: [s * reach, (Math.cos(lean) * length) / 2, c * reach],
      });
    }
    return parts;
  },
  dimensions: roundDimensions,
});
