import { box, colorParam, cylinder, shade, tilted } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { roundDimensions, sizeOf } from '../../furniture/size';

const BLADES = 9;

/** A clump of tall grass: a dense base and blades fanning out from it. */
export default definePiece({
  id: 'garden.grass',
  parts: (values) => {
    const { width: w, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    const parts: Part[] = [
      cylinder([0, h * 0.12, 0], w * 0.45, h * 0.24, shade(color, -0.2), 'body'),
    ];
    const fan = Math.atan2(w / 2, h);
    for (let i = 0; i < BLADES; i++) {
      const turn = (i / BLADES) * 2 * Math.PI;
      const lean = i === 0 ? 0 : fan * (0.6 + 0.4 * (i % 2));
      const blade = tilted(
        box([0, h / 2, 0], [0.04, h, 0.01], shade(color, (i % 3) * 0.05), 'detail'),
        lean,
      );
      // Lean outwards, then turn the blade round the clump.
      const [c, s] = [Math.cos(turn), Math.sin(turn)];
      const reach = (Math.sin(lean) * h) / 2;
      parts.push({
        ...blade,
        center: [s * reach, (Math.cos(lean) * h) / 2, c * reach],
        rotationY: turn,
      });
    }
    return parts;
  },
  dimensions: roundDimensions,
});
