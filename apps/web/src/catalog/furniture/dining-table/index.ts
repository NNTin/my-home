import { METAL, wood } from '../../cabinet';
import { box, colorParam, plank } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../size';

const TOP = 0.03;
/** The legs' square section, and how far they stand in from the top's edges. */
const LEG = 0.04;
const INSET = 0.06;
/** The frame under the top between the legs. */
const APRON = 0.07;

/**
 * A dining table: a wooden top with the grain along it (veneer stained to its colour, or lacquer
 * for a colour lighter than oak) on four square metal legs joined by a frame under the top.
 */
export default definePiece({
  id: 'furniture.dining-table',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const top = wood(colorParam(values, 'color'));
    const legs = colorParam(values, 'legColor');
    const under = h - TOP;
    const [lx, lz] = [w / 2 - INSET - LEG / 2, d / 2 - INSET - LEG / 2];
    const parts: Part[] = [
      plank([0, h - TOP / 2, 0], [w, TOP, d], top.color, 'board', top.material),
    ];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        parts.push(box([sx * lx, under / 2, sz * lz], [LEG, under, LEG], legs, 'post', METAL));
      }
    }
    const y = under - APRON / 2;
    for (const s of [-1, 1]) {
      parts.push(
        box([0, y, s * lz], [2 * lx - LEG, APRON, LEG / 2], legs, 'body', METAL),
        box([s * lx, y, 0], [LEG / 2, APRON, 2 * lz - LEG], legs, 'body', METAL),
      );
    }
    return parts;
  },
  dimensions: furnitureDimensions,
});
