import { box, colorParam, cylinder, dimension, numberParam, shade } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';

const PANEL = 0.02;
const PIPE_DROP = 0.08;

/**
 * A compact panel radiator on two brackets: the back of its frame (-z) is the wall, `depth` the
 * whole projection from it. The panels (one, two or three by the depth left after the bracket gap)
 * stand in front of the gap, a grille on top; the thermostat valve on one end with its pipe going
 * down. The frame starts at the radiator's bottom.
 */
export default definePiece({
  id: 'fixture.radiator',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    const gap = Math.min(numberParam(values, 'wallGap'), d - PANEL);
    const body = d - gap;
    const panels = body <= 0.07 ? 1 : body <= 0.12 ? 2 : 3;
    const back = -d / 2 + gap;
    const zc = back + body / 2;
    const parts: Part[] = [];
    for (let i = 0; i < panels; i++) {
      const z = panels === 1 ? zc : back + PANEL / 2 + ((body - PANEL) * i) / (panels - 1);
      parts.push(
        box([0, h / 2, z], [w, h, PANEL], i === panels - 1 ? color : shade(color, -0.1), 'body'),
      );
    }
    if (panels > 1) {
      parts.push(
        box(
          [0, h - 0.004, zc],
          [w - 0.01, 0.008, body - 2 * PANEL + 0.004],
          shade(color, -0.3),
          'detail',
        ),
      );
    }
    parts.push(
      ...[-1, 1].map((s) =>
        box(
          [s * (w / 3), h * 0.75, -d / 2 + gap / 2],
          [0.03, 0.06, gap],
          shade(color, -0.25),
          'detail',
        ),
      ),
    );
    const side = String(values.valveSide) === 'left' ? -1 : 1;
    const valve = colorParam(values, 'valveColor');
    const vx = side * (w / 2 + 0.03);
    parts.push(
      cylinder([vx, h - 0.06, zc], 0.05, 0.09, valve, 'handle'),
      // The pipe from the valve down past the radiator's bottom, towards the floor.
      cylinder(
        [vx, (h - 0.105 - PIPE_DROP) / 2, zc],
        0.016,
        h - 0.105 + PIPE_DROP,
        shade(valve, -0.08),
        'detail',
      ),
    );
    return parts;
  },
  dimensions: (values) => {
    const { width: w, depth: d } = sizeOf(values);
    const gap = Math.min(numberParam(values, 'wallGap'), d - PANEL);
    return [
      ...furnitureDimensions(values),
      dimension([-w / 2, 0, -d / 2], [-w / 2, 0, -d / 2 + gap], gap, 'Gap to the wall'),
    ];
  },
});
