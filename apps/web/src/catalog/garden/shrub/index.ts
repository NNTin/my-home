import { box, colorParam, lathe, shade } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { roundDimensions, sizeOf } from '../../furniture/size';
import { bushProfile } from '../plants';
import { jitter } from '../random';

/** The clumps that grow out of the bush's middle. */
const CLUMPS = 7;
const FLOWERS = 14;

/**
 * A bush: a rounded middle with clumps of leaves growing out of it all round, so that it is
 * round but not smooth; with roses, flowers dotted over it.
 */
export default definePiece({
  id: 'garden.shrub',
  parts: (values) => {
    const { width: w, height: h } = sizeOf(values);
    const leaf = colorParam(values, 'leafColor');
    const parts: Part[] = [lathe([0, 0, 0], bushProfile(w * 0.4, h * 0.94, 0.3), leaf, 'body')];
    const clumps = Array.from({ length: CLUMPS }, (_, i) => {
      const a = ((i + jitter(i) * 0.6) / CLUMPS) * 2 * Math.PI;
      // A clump stands out to the bush's width and ends between half its height and its top.
      const radius = w * (0.2 + 0.07 * jitter(i + 20));
      const bottom = h * (0.05 + 0.3 * jitter(i + 40));
      const height = Math.min(h * (0.6 + 0.12 * (i % 3)) - bottom + (i ? 0 : h * 0.2), h - bottom);
      return { a, radius, bottom, height, x: Math.cos(a) * w * 0.23, z: Math.sin(a) * w * 0.23 };
    });
    for (const [i, c] of clumps.entries())
      parts.push(
        lathe(
          [c.x, c.bottom, c.z],
          // Nearly pointed at its foot: a clump that starts over the ground shows no flat underside.
          bushProfile(c.radius, c.height, 0.05),
          shade(leaf, 0.04 + (i % 3) * 0.05),
          'body',
        ),
      );
    if (String(values.flowers) === 'roses') {
      const flower = colorParam(values, 'flowerColor');
      for (let i = 0; i < FLOWERS; i++) {
        // On the outer side of a clump, where it is widest.
        const c = clumps[i % CLUMPS]!;
        const a = c.a + (jitter(i) - 0.5) * 1.6;
        const out = c.radius * 0.93;
        parts.push({
          ...box(
            [
              c.x + Math.cos(a) * out,
              c.bottom + c.height * (0.2 + 0.4 * jitter(i + 50)),
              c.z + Math.sin(a) * out,
            ],
            [0.07, 0.07, 0.07],
            flower,
            'detail',
          ),
          rotationY: -a,
        });
      }
    }
    return parts;
  },
  dimensions: roundDimensions,
});
