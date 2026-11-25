import type { FinishAbout } from '../types';
import { polyHaven } from './source';

/**
 * What the catalogue page and the asset manifest say about the finishes of `parts.ts`
 * (`../listing.ts`). A module of its own: the viewer's first chunk holds none of it.
 */
export const partsAbout: Record<string, FinishAbout> = {
  'wood.veneer': {
    description: 'Oak veneer with a straight grain, for furniture fronts, tops and shelves.',
    source: polyHaven('oak_veneer_01'),
  },
  'fabric.weave': {
    description: 'A plain woven cloth, for upholstery, cushions and curtains.',
    source: polyHaven('rough_linen'),
  },
  'metal.brushed': {
    description: 'Brushed steel or aluminium: handles, legs, appliance fronts.',
  },
  'ceramic.white': {
    description: 'Glazed white ceramic: sanitary ware and sinks.',
  },
  'plastic.matt': {
    description: 'A plain matt surface for coated, lacquered and plastic parts.',
  },
  'glass.clear': {
    description: 'Smooth clear glass. A part sets how see-through it is.',
  },
};
