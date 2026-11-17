import { frameOf, frameParts, holeDimensions } from '../../openings/frame';
import { definePiece } from '../../types';

/** Drawn open: the frame only, without a sill. */
export default definePiece({
  id: 'door.exterior',
  parts: (values, ctx) => frameParts(ctx, { ...frameOf(values), sill: false }),
  dimensions: (_values, ctx) => holeDimensions(ctx),
});
