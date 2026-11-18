import { colorParam, numberParam } from '../../parts';
import { frameOf, frameParts, framedDimensions } from '../../openings/frame';
import { definePiece } from '../../types';

/** A frame without a sill and a closed panel down to the floor. */
export default definePiece({
  id: 'door.garage',
  parts: (values, ctx) =>
    frameParts(ctx, {
      ...frameOf(values),
      sill: false,
      fill: {
        kind: 'panel',
        depth: numberParam(values, 'panelDepth'),
        color: colorParam(values, 'panelColor'),
      },
    }),
  dimensions: (values, ctx) => framedDimensions(values, ctx),
});
