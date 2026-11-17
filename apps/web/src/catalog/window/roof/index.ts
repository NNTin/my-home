import { box, colorParam, dimension, numberParam } from '../../parts';
import { definePiece } from '../../types';

/**
 * A single pane lying in the roof: `ctx.width` along the ridge, `ctx.height` down the slope, the
 * pane's `thickness` up (local y). The builder tilts it onto the roof plane.
 */
export default definePiece({
  id: 'window.roof',
  parts: (values, ctx) => [
    box(
      [0, 0, 0],
      [ctx.width, numberParam(values, 'thickness'), ctx.height],
      colorParam(values, 'glassColor'),
      'glass',
      {
        metalness: numberParam(values, 'metalness'),
        roughness: numberParam(values, 'roughness'),
        receiveShadow: false,
      },
    ),
  ],
  dimensions: (_values, { width: w, height: l }) => [
    dimension([-w / 2, 0, l / 2], [w / 2, 0, l / 2], w),
    dimension([w / 2, 0, -l / 2], [w / 2, 0, l / 2], l),
  ],
});
