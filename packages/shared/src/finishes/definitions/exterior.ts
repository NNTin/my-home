import type { Finish } from '../types';
import { polyHaven } from './source';

export const exterior: Finish[] = [
  {
    id: 'render.facade',
    name: 'Facade render',
    description: 'Coarse exterior render: a colour with a rough relief. The default of the facade.',
    surfaces: ['facade'],
    // Relief only: the colour is the tint.
    texture: { id: 'render-facade', maps: ['normal'] },
    tileSize: 1.8,
    tint: '#ded8ca',
    tintable: true,
    roughness: 0.95,
    metalness: 0,
    source: polyHaven('white_stucco_02'),
  },
  {
    id: 'roof.clay-tile',
    name: 'Clay roof tiles',
    description: 'Red clay roof tiles in rows up the slope. The default of the roof.',
    surfaces: ['roof'],
    texture: { id: 'roof-clay-tile', maps: ['color', 'normal', 'roughness'] },
    tileSize: 2.5,
    tint: '#ffffff',
    tintable: false,
    roughness: 1,
    metalness: 0,
    source: polyHaven('clay_roof_tiles_02'),
  },
  {
    id: 'cut.dark',
    name: 'Cut face',
    description:
      'The dark plain face of a cut through walls, slabs and furniture. Drawn by the viewer only.',
    surfaces: [],
    tint: '#35322f',
    tintable: false,
    roughness: 1,
    metalness: 0,
  },
];
