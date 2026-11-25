import type { ParamValues } from '@my-home/shared';
import { fittingCount, frameOf, frameParts, framedDimensions, glassOf } from '../../openings/frame';
import { definePiece, type PieceContext } from '../../types';

const leaves = (values: ParamValues, ctx: PieceContext) =>
  fittingCount('door.french', 'leaves', values, ctx.width);

/**
 * A frame without a sill and glazed leaves down to the floor, each with its stiles, rails and
 * handle; more leaves add mullions.
 */
export default definePiece({
  id: 'door.french',
  parts: (values, ctx) =>
    frameParts(ctx, {
      ...frameOf(values),
      divisions: leaves(values, ctx),
      fill: glassOf(values),
    }),
  dimensions: (values, ctx) =>
    framedDimensions(values, ctx, { count: leaves(values, ctx), each: 'Leaf' }),
});
