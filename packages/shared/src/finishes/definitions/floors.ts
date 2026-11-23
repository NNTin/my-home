import type { Finish } from '../types';
import { ambientCg, polyHaven } from './source';

export const floors: Finish[] = [
  {
    id: 'wood.oak-laminate',
    name: 'Oak laminate',
    description: 'Light oak planks, as laminate or parquet flooring. Also the default of stairs.',
    surfaces: ['floor'],
    texture: { id: 'wood-oak-laminate', maps: ['color', 'normal', 'roughness'] },
    tileSize: 1.7,
    tint: '#ffffff',
    tintable: true,
    roughness: 1,
    metalness: 0,
    source: polyHaven('laminate_floor_02'),
  },
  {
    id: 'tile.light-60',
    name: 'Light tile, 60 cm',
    description:
      'Square white tiles of 60 cm with a thin joint, for floors and walls. One repeat is four tiles each way.',
    surfaces: ['floor', 'wall'],
    texture: { id: 'tile-light-60', maps: ['color', 'normal', 'roughness'] },
    // The source's own scale is not used: the repeat is cut to 4 x 4 tiles, drawn at 60 cm each.
    tileSize: 2.4,
    tint: '#ffffff',
    tintable: true,
    roughness: 1,
    metalness: 0,
    source: ambientCg('Tiles107', { crop: 0.5 }),
  },
  {
    id: 'concrete.screed',
    name: 'Concrete screed',
    description: 'Smooth grey concrete: a bare screed floor, and the default of embankments.',
    surfaces: ['floor', 'ground'],
    texture: { id: 'concrete-screed', maps: ['color', 'normal', 'roughness'] },
    tileSize: 3,
    tint: '#ffffff',
    tintable: true,
    roughness: 1,
    metalness: 0,
    source: polyHaven('concrete_floor_worn_001'),
  },
  {
    id: 'floor.neutral',
    name: 'Neutral floor',
    description: 'A plain matt floor. The default of a room whose floor nobody has chosen yet.',
    surfaces: ['floor'],
    tint: '#cfc9bd',
    tintable: true,
    roughness: 0.8,
    metalness: 0,
  },
];
