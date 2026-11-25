import type { FinishAbout } from '../types';
import { polyHaven } from './source';

/**
 * What the catalogue page and the asset manifest say about the finishes of `exterior.ts`
 * (`../listing.ts`). A module of its own: the viewer's first chunk holds none of it.
 */
export const exteriorAbout: Record<string, FinishAbout> = {
  'render.facade': {
    description: 'Coarse exterior render: a colour with a rough relief. The default of the facade.',
    source: polyHaven('white_stucco_02'),
  },
  'roof.clay-tile': {
    description: 'Red clay roof tiles in rows up the slope. The default of the roof.',
    source: polyHaven('clay_roof_tiles_02'),
  },
  'cut.dark': {
    description:
      'The dark plain face of a cut through walls, slabs and furniture. Drawn by the viewer only.',
  },
};
