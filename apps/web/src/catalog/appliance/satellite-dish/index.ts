import type { Vec2 } from '../../../builder/buildHome';
import { LACQUER, METAL } from '../../cabinet';
import { box, colorParam, lathe, numberParam, rod, tilted } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { roundDimensions } from '../../furniture/size';

/** How deep the reflector is, as a share of its diameter. */
const DISH = 0.1;
const MAST = 0.04;

/**
 * A satellite dish on a wall: a plate on the wall (-z), a mast out to the back of the reflector,
 * the reflector looking forward (+z) and the receiver on an arm from its lower rim. The piece is
 * as deep as it is wide; its middle is the reflector's middle.
 */
export default definePiece({
  id: 'appliance.satellite-dish',
  parts: (values) => {
    const size = numberParam(values, 'diameter');
    const r = size / 2;
    const dish = colorParam(values, 'color');
    const bracket = colorParam(values, 'bracketColor');
    // The reflector's vertex, a quarter of the depth out from the wall.
    const vertex = -r / 2;
    // A paraboloid's skin, turned about y and then laid along z, open towards +z.
    const skin: Vec2[] = [0, 0.4, 0.7, 1].map((t) => [t * r, t * t * DISH * size]);
    const rim = vertex + DISH * size;
    // The arm runs from the reflector's lower rim up and out to the receiver.
    const from: Vec2 = [0.05 * r, rim];
    const to: Vec2 = [0.6 * r, r - 0.06];
    const [dy, dz] = [to[0] - from[0], to[1] - from[1]];
    const parts: Part[] = [
      box([0, r, -r + 0.01], [0.12, 0.2, 0.02], bracket, 'detail', METAL),
      rod([0, r, (vertex - r) / 2], MAST, r + vertex, bracket, 'detail', 'z', METAL),
      {
        ...tilted(lathe([0, 0, 0], skin, dish, 'body', LACQUER), Math.PI / 2),
        center: [0, r, vertex + (DISH * size) / 2],
      },
      {
        ...tilted(
          box([0, 0, 0], [0.025, Math.hypot(dy, dz), 0.025], bracket, 'detail', METAL),
          Math.atan2(dz, dy),
        ),
        center: [0, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2],
      },
      rod([0, to[0], r - 0.06], 0.05, 0.12, dish, 'detail', 'z', LACQUER),
    ];
    return parts;
  },
  dimensions: roundDimensions,
});
