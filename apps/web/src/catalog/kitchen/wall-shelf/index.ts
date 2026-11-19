import { box, colorParam, dimension, numberParam } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { sizeOf } from '../../furniture/size';

/** Hooks along the rail, about this far apart. */
const HOOK_SPACING = 0.15;

/**
 * An open shelf board on hidden brackets, its back against the wall (-z); the frame starts at the
 * board's bottom. An optional rail with hooks hangs `railDrop` below it on the wall.
 */
export default definePiece({
  id: 'kitchen.wall-shelf',
  parts: (values) => {
    const { width: w, depth: d, height: t } = sizeOf(values);
    const parts: Part[] = [box([0, t / 2, 0], [w, t, d], colorParam(values, 'color'), 'board')];
    if (String(values.rail) === 'hooks') {
      const rail = colorParam(values, 'railColor');
      const y = -numberParam(values, 'railDrop');
      const length = Math.max(0.2, w - 0.2);
      const z = -d / 2 + 0.025;
      parts.push(
        box([0, y, z], [length, 0.012, 0.012], rail, 'detail'),
        ...[-1, 1].map((side) =>
          box([side * (length / 2 - 0.02), y, -d / 2 + 0.01], [0.02, 0.02, 0.02], rail, 'detail'),
        ),
      );
      const hooks = Math.max(1, Math.floor(length / HOOK_SPACING));
      for (let i = 0; i < hooks; i++) {
        const x = -length / 2 + (length / hooks) * (i + 0.5);
        parts.push(box([x, y - 0.03, z + 0.008], [0.005, 0.05, 0.005], rail, 'detail'));
      }
    }
    return parts;
  },
  dimensions: (values) => {
    const { width: w, depth: d, height: t } = sizeOf(values);
    const lines = [
      dimension([-w / 2, t, d / 2], [w / 2, t, d / 2], w, 'Length'),
      dimension([w / 2, t, d / 2], [w / 2, t, -d / 2], d, 'Depth'),
      dimension([-w / 2, 0, d / 2], [-w / 2, t, d / 2], t, 'Thickness'),
    ];
    if (String(values.rail) === 'hooks') {
      const drop = numberParam(values, 'railDrop');
      lines.push(
        dimension(
          [-w / 2 + 0.1, -drop, -d / 2],
          [-w / 2 + 0.1, 0, -d / 2],
          drop,
          'Rail below the board',
        ),
      );
    }
    return lines;
  },
});
