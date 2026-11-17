import type { ParamValues } from '@my-home/shared';
import type { Box } from '../../../builder/buildHome';
import { fenceLine, type FenceSpec } from '../../../builder/fence';
import { colorParam, dimension, numberParam } from '../../parts';
import { definePiece, type Part } from '../../types';

/** The sizes the builder walks a gate's fence line with. */
export const gateSpec = (values: ParamValues): FenceSpec => ({
  postSize: numberParam(values, 'postSize'),
  postExtra: numberParam(values, 'postExtra'),
  panelDepth: numberParam(values, 'panelDepth'),
  bay: numberParam(values, 'bay'),
});

/** The posts, then the panels, of a gate's fence line (in the line's frame, the plan for a use). */
export function gateParts(values: ParamValues, line: { posts: Box[]; panels: Box[] }): Part[] {
  const part = (b: Box, color: string, role: Part['role']): Part => ({
    shape: 'box',
    center: b.center,
    size: b.size,
    rotationY: b.rotationY,
    color,
    role,
  });
  return [
    ...line.posts.map((p) => part(p, colorParam(values, 'postColor'), 'post')),
    ...line.panels.map((p) => part(p, colorParam(values, 'color'), 'panel')),
  ];
}

/** Previews: a straight gate of `ctx.width` along x, standing on y = 0, centred on the origin. */
export default definePiece({
  id: 'gate.swing',
  parts: (values, ctx) =>
    gateParts(
      values,
      fenceLine(
        'preview',
        [
          [-ctx.width / 2, 0],
          [ctx.width / 2, 0],
        ],
        ctx.height,
        0,
        0,
        gateSpec(values),
      ),
    ),
  dimensions: (_values, { width: w, height: h }) => [
    dimension([-w / 2, 0, 0], [w / 2, 0, 0], w),
    dimension([w / 2, 0, 0], [w / 2, h, 0], h),
  ],
});
