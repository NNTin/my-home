import { LACQUER } from '../../cabinet';
import { box, colorParam, dimension, numberParam } from '../../parts';
import { definePiece } from '../../types';

/** The frame around the pane: its cladding, as wide as this and a little proud of the pane. */
const FRAME = 0.05;
const CLADDING = '#4a4d50';

/**
 * A pane lying in the roof in a frame of dark cladding: `ctx.width` along the ridge, `ctx.height`
 * down the slope, the pane's `thickness` up (local y). The builder tilts it onto the roof plane.
 */
export default definePiece({
  id: 'window.roof',
  parts: (values, ctx) => {
    const { width: w, height: l } = ctx;
    const t = numberParam(values, 'thickness');
    const f = Math.min(FRAME, w / 4, l / 4);
    const member = (x: number, z: number, sx: number, sz: number) =>
      box([x, 0.005, z], [sx, t + 0.01, sz], CLADDING, 'frame', LACQUER);
    return [
      member(-w / 2 + f / 2, 0, f, l),
      member(w / 2 - f / 2, 0, f, l),
      member(0, -l / 2 + f / 2, w - 2 * f, f),
      member(0, l / 2 - f / 2, w - 2 * f, f),
      box([0, 0, 0], [w - 2 * f, t, l - 2 * f], colorParam(values, 'glassColor'), 'glass', {
        metalness: numberParam(values, 'metalness'),
        roughness: numberParam(values, 'roughness'),
        receiveShadow: false,
      }),
    ];
  },
  dimensions: (_values, { width: w, height: l }) => [
    dimension([-w / 2, 0, l / 2], [w / 2, 0, l / 2], w, 'Width'),
    dimension([w / 2, 0, -l / 2], [w / 2, 0, l / 2], l, 'Length'),
  ],
});
