import { LACQUER } from '../../cabinet';
import { box, colorParam, cylinder, dimension, lathe, numberParam, rod, shade } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';

const PANEL = 0.02;
const PIPE_DROP = 0.08;
/** The front panel is pressed into upright ribs, about this far apart. */
const RIB = 0.033;

/** The thermostat head from its foot up: a neck, the grip and its rounded cap. */
const HEAD: [number, number][] = [
  [0, 0],
  [0.016, 0],
  [0.016, 0.02],
  [0.025, 0.028],
  [0.025, 0.078],
  [0.019, 0.09],
  [0, 0.09],
];

/**
 * A compact panel radiator on two brackets: the back of its frame (-z) is the wall, `depth` the
 * whole projection from it. The panels (one, two or three by the depth left after the bracket gap)
 * stand in front of the gap, the front one pressed into upright ribs, with a grille on top and a
 * cover on each end; the thermostat valve on one end with its pipe going down, and the return
 * at the bottom of the same end. The frame starts at the radiator's bottom.
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
    const enamel = (center: Part['center'], size: Part['size'], tone = color) =>
      parts.push(box(center, size, tone, 'body', LACQUER));
    for (let i = 0; i < panels - 1; i++)
      enamel(
        [0, h / 2, back + PANEL / 2 + ((body - PANEL) * i) / (panels - 1)],
        [w, h, PANEL],
        shade(color, -0.1),
      );
    // The front panel: a sheet with its ribs standing 4 mm proud, between a plain top and bottom edge.
    enamel([0, h / 2, d / 2 - PANEL / 2 - 0.002], [w, h, PANEL - 0.004]);
    const ribs = Math.max(1, Math.floor((w - 0.03) / RIB));
    for (let i = 0; i < ribs; i++)
      enamel([(i - (ribs - 1) / 2) * RIB, h / 2, d / 2 - 0.002], [RIB * 0.62, h - 0.05, 0.004]);
    if (panels > 1) {
      enamel([0, h - 0.004, zc], [w - 0.01, 0.008, body - 2 * PANEL + 0.004], shade(color, -0.3));
      for (const side of [-1, 1])
        enamel(
          [side * (w / 2 - 0.0015), h / 2 - 0.004, zc],
          [0.003, h - 0.008, body - 2 * PANEL + 0.004],
        );
    }
    for (const side of [-1, 1])
      enamel([side * (w / 3), h * 0.75, -d / 2 + gap / 2], [0.03, 0.06, gap], shade(color, -0.25));
    const side = String(values.valveSide) === 'left' ? -1 : 1;
    const valve = colorParam(values, 'valveColor');
    const pipe = shade(valve, -0.08);
    const vx = side * (w / 2 + 0.03);
    parts.push(
      lathe([vx, h - 0.105, zc], HEAD, valve, 'handle', LACQUER),
      // The pipe from the valve down past the radiator's bottom, towards the floor, joined to
      // the radiator under the head and, for the return, near its bottom.
      {
        ...cylinder(
          [vx, (h - 0.105 - PIPE_DROP) / 2, zc],
          0.016,
          h - 0.105 + PIPE_DROP,
          pipe,
          'detail',
        ),
        material: LACQUER,
      },
      ...[h - 0.115, 0.05].map((y) =>
        rod([side * (w / 2 + 0.015), y, zc], 0.022, 0.03, pipe, 'detail', 'x', LACQUER),
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
