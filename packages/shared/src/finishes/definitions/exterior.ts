import type { Finish } from '../types';

export const exterior: Finish[] = [
  {
    id: 'render.facade',
    name: 'Facade render',
    surfaces: ['facade'],
    // Relief only: the colour is the tint.
    texture: { id: 'render-facade', maps: ['normal'] },
    tileSize: 1.8,
    tint: '#ded8ca',
    tintable: true,
    roughness: 0.95,
    metalness: 0,
  },
  {
    id: 'roof.clay-tile',
    name: 'Clay roof tiles',
    surfaces: ['roof'],
    texture: { id: 'roof-clay-tile', maps: ['color', 'normal', 'roughness'] },
    tileSize: 2.5,
    tint: '#ffffff',
    tintable: false,
    roughness: 1,
    metalness: 0,
  },
  {
    id: 'cut.dark',
    name: 'Cut face',
    surfaces: [],
    tint: '#35322f',
    tintable: false,
    roughness: 1,
    metalness: 0,
  },
];
