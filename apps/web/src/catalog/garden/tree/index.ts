import { colorParam, dimension, lathe, numberParam, shade } from '../../parts';
import { definePiece } from '../../types';
import { sizeOf } from '../../furniture/size';
import { bushProfile } from '../plants';
import { jitter } from '../random';

/** The masses of leaves that grow out of the crown's middle. */
const CLUMPS = 6;

/**
 * A broadleaved tree: a trunk that tapers into its crown, and a crown made like a shrub's, a
 * rounded middle with clumps of leaves growing out of it all round. The crown starts where the
 * trunk's clear height ends, at most six tenths of the way up.
 */
export default definePiece({
  id: 'garden.tree',
  parts: (values) => {
    const { width: w, height: h } = sizeOf(values);
    const leaf = colorParam(values, 'leafColor');
    const clear = Math.min(numberParam(values, 'trunkHeight'), h * 0.6);
    const crown = h - clear;
    const girth = Math.min(0.5, 0.05 + h * 0.025);
    return [
      // Into the crown by a third of it: no leaf mass hangs free of the trunk.
      lathe(
        [0, 0, 0],
        [
          [0, 0],
          [girth * 1.3, 0],
          [girth, clear * 0.15],
          [girth * 0.7, clear + crown / 3],
          [0, clear + crown / 3],
        ],
        colorParam(values, 'trunkColor'),
        'post',
      ),
      lathe([0, clear, 0], bushProfile(w * 0.36, crown * 0.96, 0.25), leaf, 'body'),
      ...Array.from({ length: CLUMPS }, (_, i) => {
        const a = ((i + jitter(i) * 0.6) / CLUMPS) * 2 * Math.PI;
        // A clump stands out to the crown's width; the first reaches the tree's top.
        const radius = w * (0.2 + 0.06 * jitter(i + 20));
        const reach = w / 2 - radius;
        const bottom = clear + crown * (0.02 + 0.2 * jitter(i + 40));
        const top = i ? clear + crown * (0.62 + 0.12 * (i % 3)) : h;
        return lathe(
          [Math.cos(a) * reach, bottom, Math.sin(a) * reach],
          bushProfile(radius, top - bottom, 0.1),
          shade(leaf, 0.03 + (i % 3) * 0.05),
          'body',
        );
      }),
    ];
  },
  dimensions: (values) => {
    const { width: w, height: h } = sizeOf(values);
    const clear = Math.min(numberParam(values, 'trunkHeight'), h * 0.6);
    return [
      dimension([-w / 2, 0, w / 2], [w / 2, 0, w / 2], w, 'Crown'),
      dimension([w / 2, 0, 0], [w / 2, h, 0], h, 'Height'),
      dimension([0, 0, w / 2], [0, clear, w / 2], clear, 'Clear trunk'),
    ];
  },
});
