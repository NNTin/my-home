import { windowDimensions, windowParts } from '../../openings/window';
import { definePiece } from '../../types';

/**
 * The standard German window (`openings/window.ts`): frame, sashes with glass, handle and hinges,
 * window board inside, sill outside; optional roller shutter and curtain.
 */
export default definePiece({
  id: 'window.tilt-turn',
  parts: (values, ctx) => windowParts('window.tilt-turn', values, ctx),
  dimensions: (values, ctx) => windowDimensions('window.tilt-turn', values, ctx),
});
