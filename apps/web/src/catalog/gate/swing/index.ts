import type { ParamValues } from '@my-home/shared';
import type { Box } from '../../../geom/types';
import { fenceLine, type FenceSpec } from '../../../builder/fence';
import { LACQUER } from '../../cabinet';
import { box, colorParam, dimension, numberParam, shade } from '../../parts';
import { definePiece, type Part } from '../../types';

/** A post's cap and a panel's rails. */
const CAP = 0.02;
const RAIL = 0.06;

/** The sizes the builder walks a gate's fence line with. */
export const gateSpec = (values: ParamValues): FenceSpec => ({
  postSize: numberParam(values, 'postSize'),
  postExtra: numberParam(values, 'postExtra'),
  panelDepth: numberParam(values, 'panelDepth'),
  bay: numberParam(values, 'bay'),
});

/**
 * The posts, then the panels, of a gate's fence line (in the line's frame, the plan for a use):
 * each post under a cap, each panel between a top and a bottom rail that stand proud of it, and a
 * latch on the first panel's end.
 */
export function gateParts(values: ParamValues, line: { posts: Box[]; panels: Box[] }): Part[] {
  /** The box grown by `grow`, lifted by `lift` and moved `along` its own length. */
  const part = (
    b: Box,
    color: string,
    role: Part['role'],
    grow = [0, 0, 0],
    lift = 0,
    along = 0,
  ): Part => ({
    ...box(
      [
        b.center[0] + Math.cos(b.rotationY) * along,
        b.center[1] + lift,
        b.center[2] - Math.sin(b.rotationY) * along,
      ],
      [b.size[0] + grow[0]!, b.size[1] + grow[1]!, b.size[2] + grow[2]!],
      color,
      role,
      LACQUER,
    ),
    rotationY: b.rotationY,
  });
  const [post, leaf] = [colorParam(values, 'postColor'), colorParam(values, 'color')];
  const rail = shade(leaf, -0.2);
  return [
    ...line.posts.flatMap((p) => [
      part(p, post, 'post'),
      part(p, shade(post, -0.2), 'post', [0.02, CAP - p.size[1], 0.02], p.size[1] / 2 + CAP / 2),
    ]),
    ...line.panels.flatMap((p) => [
      part(p, leaf, 'panel'),
      ...[-1, 1].map((side) =>
        part(p, rail, 'panel', [0, RAIL - p.size[1], 0.02], side * (p.size[1] / 2 - RAIL / 2)),
      ),
    ]),
    // The latch, at the end of the first panel.
    ...line.panels
      .slice(0, 1)
      .map((p) =>
        part(
          p,
          shade(leaf, -0.6),
          'handle',
          [0.1 - p.size[0], 0.03 - p.size[1], 0.05],
          0,
          p.size[0] / 2 - 0.08,
        ),
      ),
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
    dimension([-w / 2, 0, 0], [w / 2, 0, 0], w, 'Width'),
    dimension([w / 2, 0, 0], [w / 2, h, 0], h, 'Height'),
  ],
});
