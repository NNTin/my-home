import type { ParamValues } from '@my-home/shared';
import { fittingCount, frameOf, frameParts, framedDimensions, glassOf } from '../../openings/frame';
import { definePiece, type PieceContext } from '../../types';

const sashes = (values: ParamValues, ctx: PieceContext) =>
  fittingCount('window.tilt-turn', 'sashes', values, ctx.width);

/** A framed pane with a sill; more sashes add mullions. */
export default definePiece({
  id: 'window.tilt-turn',
  parts: (values, ctx) =>
    frameParts(ctx, {
      ...frameOf(values),
      sill: true,
      divisions: sashes(values, ctx),
      fill: glassOf(values),
    }),
  dimensions: (values, ctx) =>
    framedDimensions(values, ctx, { count: sashes(values, ctx), each: 'Sash' }),
});
