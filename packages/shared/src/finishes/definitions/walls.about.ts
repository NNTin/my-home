import type { FinishAbout } from '../types';
import { polyHaven } from './source';

/**
 * What the catalogue page and the asset manifest say about the finishes of `walls.ts`
 * (`../listing.ts`). A module of its own: the viewer's first chunk holds none of it.
 */
export const wallsAbout: Record<string, FinishAbout> = {
  'plaster.fine': {
    description: 'Painted fine plaster: a colour with a light relief, for walls and ceilings.',
    source: polyHaven('white_plaster_02'),
  },
  'paint.plain': {
    description:
      'A plain painted surface. The default of walls and ceilings nobody has chosen yet, and of painted outbuildings.',
  },
  'shell.neutral': {
    description:
      'A muted plain surface for what is not modelled inside: every inner surface of the upper floors.',
  },
};
