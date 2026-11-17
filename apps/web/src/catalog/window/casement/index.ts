import { fittingCount, frameOf, frameParts, glassOf, holeDimensions } from '../../openings/frame';
import { definePiece } from '../../types';

/** A framed pane with a sill; more sashes add mullions. */
export default definePiece({
  id: 'window.casement',
  parts: (values, ctx) =>
    frameParts(ctx, {
      ...frameOf(values),
      sill: true,
      divisions: fittingCount('window.casement', 'sashes', values, ctx.width),
      fill: glassOf(values),
    }),
  dimensions: (_values, ctx) => holeDimensions(ctx),
});
