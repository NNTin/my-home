import type { Finish } from '../types';

export const floors: Finish[] = [
  {
    id: 'wood.oak-laminate',
    name: 'Oak laminate',
    surfaces: ['floor'],
    texture: { id: 'wood-oak-laminate', maps: ['color', 'normal', 'roughness'] },
    tileSize: 1.7,
    tint: '#ffffff',
    tintable: true,
    roughness: 1,
    metalness: 0,
  },
  {
    id: 'tile.light-60',
    name: 'Light tile, 60 cm',
    surfaces: ['floor', 'wall'],
    texture: { id: 'tile-light-60', maps: ['color', 'normal', 'roughness'] },
    // The source's own scale is not used: the repeat is cut to 4 x 4 tiles, drawn at 60 cm each.
    tileSize: 2.4,
    tint: '#ffffff',
    tintable: true,
    roughness: 1,
    metalness: 0,
  },
  {
    id: 'concrete.screed',
    name: 'Concrete screed',
    surfaces: ['floor', 'ground'],
    texture: { id: 'concrete-screed', maps: ['color', 'normal', 'roughness'] },
    tileSize: 3,
    tint: '#ffffff',
    tintable: true,
    roughness: 1,
    metalness: 0,
  },
  {
    id: 'floor.neutral',
    name: 'Neutral floor',
    surfaces: ['floor'],
    tint: '#cfc9bd',
    tintable: true,
    roughness: 0.8,
    metalness: 0,
  },
];
