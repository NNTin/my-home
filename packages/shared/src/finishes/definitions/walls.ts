import type { Finish } from '../types';
import { polyHaven } from './source';

export const walls: Finish[] = [
  {
    id: 'plaster.fine',
    name: 'Fine plaster',
    description: 'Painted fine plaster: a colour with a light relief, for walls and ceilings.',
    surfaces: ['wall', 'ceiling'],
    // Relief only: the colour is the tint.
    texture: { id: 'plaster-fine', maps: ['normal'] },
    tileSize: 1,
    tint: '#f2efe8',
    tintable: true,
    roughness: 0.9,
    metalness: 0,
    source: polyHaven('white_plaster_02'),
  },
  {
    id: 'paint.plain',
    name: 'Plain paint',
    description:
      'A plain painted surface. The default of walls and ceilings nobody has chosen yet, and of painted outbuildings.',
    surfaces: ['wall', 'ceiling', 'facade'],
    tint: '#f2efe8',
    tintable: true,
    roughness: 0.9,
    metalness: 0,
  },
  {
    id: 'shell.neutral',
    name: 'Neutral shell',
    description:
      'A muted plain surface for what is not modelled inside: every inner surface of the upper floors.',
    surfaces: ['floor', 'wall', 'ceiling'],
    tint: '#d6d3cc',
    tintable: false,
    roughness: 1,
    metalness: 0,
  },
];
