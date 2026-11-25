import { colorParam, numberParam } from '../../parts';
import { frameOf, frameParts, framedDimensions } from '../../openings/frame';
import { definePiece } from '../../types';

/** A frame without a sill, closed down to the floor by a sectional door. */
export default definePiece({
  id: 'door.garage',
  parts: (values, ctx) =>
    frameParts(ctx, {
      ...frameOf(values),
      fill: {
        kind: 'panel',
        depth: numberParam(values, 'panelDepth'),
        color: colorParam(values, 'panelColor'),
      },
    }),
  dimensions: (values, ctx) => framedDimensions(values, ctx),
});
