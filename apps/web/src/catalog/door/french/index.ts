import { fittingCount, frameOf, frameParts, glassOf, holeDimensions } from '../../openings/frame';
import { definePiece } from '../../types';

/** A frame without a sill and a pane down to the floor; more leaves add mullions. */
export default definePiece({
  id: 'door.french',
  parts: (values, ctx) =>
    frameParts(ctx, {
      ...frameOf(values),
      sill: false,
      divisions: fittingCount('door.french', 'leaves', values, ctx.width),
      fill: glassOf(values),
    }),
  dimensions: (_values, ctx) => holeDimensions(ctx),
});
