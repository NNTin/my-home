import type { FinishAbout } from '../types';
import { ambientCg, polyHaven } from './source';

/**
 * What the catalogue page and the asset manifest say about the finishes of `floors.ts`
 * (`../listing.ts`). A module of its own: the viewer's first chunk holds none of it.
 */
export const floorsAbout: Record<string, FinishAbout> = {
  'wood.oak-laminate': {
    description: 'Light oak planks, as laminate or parquet flooring. Also the default of stairs.',
    source: polyHaven('laminate_floor_02'),
  },
  'tile.light-60': {
    description:
      'Square white tiles of 60 cm with a thin joint, for floors and walls. One repeat is four tiles each way.',
    source: ambientCg('Tiles107', { crop: 0.5 }),
  },
  'concrete.screed': {
    description: 'Smooth grey concrete: a bare screed floor, and the default of embankments.',
    source: polyHaven('concrete_floor_worn_001'),
  },
  'floor.neutral': {
    description: 'A plain matt floor. The default of a room whose floor nobody has chosen yet.',
  },
};
