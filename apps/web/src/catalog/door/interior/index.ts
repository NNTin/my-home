import { frameOf, frameParts, framedDimensions } from '../../openings/frame';
import { definePiece } from '../../types';

/** Drawn open: the frame without a sill, with the stop its leaf closes against. */
export default definePiece({
  id: 'door.interior',
  parts: (values, ctx) => frameParts(ctx, frameOf(values)),
  dimensions: (values, ctx) => framedDimensions(values, ctx),
});
