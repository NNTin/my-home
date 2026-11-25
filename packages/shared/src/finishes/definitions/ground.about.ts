import type { FinishAbout } from '../types';
import { ambientCg, polyHaven } from './source';

/**
 * What the catalogue page and the asset manifest say about the finishes of `ground.ts`
 * (`../listing.ts`). A module of its own: the viewer's first chunk holds none of it.
 */
export const groundAbout: Record<string, FinishAbout> = {
  'grass.lawn': {
    description: 'A short, dense lawn. The default of gardens.',
    source: ambientCg('Grass004'),
  },
  'paving.concrete-slab': {
    description: 'Grey concrete slabs laid in rows. The default of patios, paths and driveways.',
    source: polyHaven('concrete_pavement'),
  },
  'gravel.fine': {
    description: 'Fine grey gravel. The default of gravel and drainage strips.',
    source: polyHaven('gravel_floor_02'),
  },
  'asphalt.plain': {
    description: 'Clean dark asphalt. The default of roads.',
    source: polyHaven('clean_asphalt'),
  },
  'soil.plain': {
    description: 'Bare brown soil: the ground itself, where nothing covers it and where it is cut.',
    source: polyHaven('dirt'),
  },
  'stone.rubble': {
    description:
      'Rough grey stones stacked dry: a rubble retaining wall or a bank of boulders in the garden.',
    source: polyHaven('broken_wall', '2026-11-24'),
  },
};
