import { METAL } from '../../cabinet';
import {
  colorParam,
  dimension,
  extrude,
  numberParam,
  plank,
  rod,
  strip,
  veneerTint,
} from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { sizeOf } from '../../furniture/size';

/** Hooks along the rail, about this far apart. */
const HOOK_SPACING = 0.15;

/** A hook is a strip of metal this wide and this thick. */
const HOOK_WIDTH = 0.005;
const HOOK_GAUGE = 0.004;

/**
 * A hook seen from its side, x away from the wall and y up from where it hangs over the rail:
 * down 5 cm, forward 2.2 cm, and up again by a short lip.
 */
const HOOK = strip(
  [
    [HOOK_GAUGE / 2, 0],
    [HOOK_GAUGE / 2, -0.05 + HOOK_GAUGE / 2],
    [0.022 - HOOK_GAUGE / 2, -0.05 + HOOK_GAUGE / 2],
    [0.022 - HOOK_GAUGE / 2, -0.036],
  ],
  HOOK_GAUGE,
);

/**
 * An open shelf board, lacquered or of oak veneer, on hidden brackets, its back against the wall (-z); the frame starts at the
 * board's bottom. An optional rail with hooks hangs `railDrop` below it on the wall.
 */
export default definePiece({
  id: 'kitchen.wall-shelf',
  parts: (values) => {
    const { width: w, depth: d, height: t } = sizeOf(values);
    // The board has the finish the use chose. Lacquer shows its colour; oak veneer is stained to
    // it (a colour lighter than oak shows the oak), its grain along the board.
    const finish = String(values.finish);
    const color = colorParam(values, 'color');
    const parts: Part[] = [
      plank(
        [0, t / 2, 0],
        [w, t, d],
        finish === 'wood.veneer' ? (veneerTint(color) ?? '#ffffff') : color,
        'board',
        { finish },
      ),
    ];
    if (String(values.rail) === 'hooks') {
      const rail = colorParam(values, 'railColor');
      const y = -numberParam(values, 'railDrop');
      const length = Math.max(0.2, w - 0.2);
      const z = -d / 2 + 0.025;
      // A round rail of brushed metal on two stand-offs from the wall, with hooks hung over it.
      parts.push(
        rod([0, y, z], 0.012, length, rail, 'detail', 'x', METAL),
        ...[-1, 1].map((side) =>
          rod(
            [side * (length / 2 - 0.02), y, -d / 2 + 0.0125],
            0.016,
            0.025,
            rail,
            'detail',
            'z',
            METAL,
          ),
        ),
      );
      const hooks = Math.max(1, Math.floor(length / HOOK_SPACING));
      for (let i = 0; i < hooks; i++) {
        const x = -length / 2 + (length / hooks) * (i + 0.5);
        // The side view runs out from the wall: the outline's x along the piece's z.
        parts.push(
          extrude([x, y - 0.005, z + 0.006], HOOK, HOOK_WIDTH, rail, 'detail', -Math.PI / 2, METAL),
        );
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
