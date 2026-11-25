import type { Finish } from '../types';

export const walls: Finish[] = [
  {
    id: 'plaster.fine',
    name: 'Fine plaster',
    surfaces: ['wall', 'ceiling'],
    // Relief only: the colour is the tint.
    texture: { id: 'plaster-fine', maps: ['normal'] },
    tileSize: 1,
    tint: '#f2efe8',
    tintable: true,
    roughness: 0.9,
    metalness: 0,
  },
  {
    id: 'paint.plain',
    name: 'Plain paint',
    surfaces: ['wall', 'ceiling', 'facade'],
    tint: '#f2efe8',
    tintable: true,
    roughness: 0.9,
    metalness: 0,
  },
  {
    id: 'shell.neutral',
    name: 'Neutral shell',
    surfaces: ['floor', 'wall', 'ceiling'],
    tint: '#d6d3cc',
    tintable: false,
    roughness: 1,
    metalness: 0,
  },
];
