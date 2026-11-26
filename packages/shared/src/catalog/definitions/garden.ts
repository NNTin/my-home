import { defineType } from '../types';
import { choice, color, count, fixedLength, length } from './specs';

// The `outdoor` kind: garden and patio pieces, placed like furniture (a placement each) but outside
// the rooms. They stand on the ground where they are placed (the terrain's surface there), not on
// their level's floor. Drawn by the piece modules in apps/web/src/catalog/garden/<name>/index.ts.
// Default sizes come from the owner's photos of the souterrain patio and garden.

export const pergola = defineType({
  id: 'garden.pergola',
  kind: 'outdoor',
  family: 'garden',
  name: 'Lean-to pergola',
  description:
    'Wooden posts and beams with a translucent corrugated roof that falls from the facade to the posts. Open: you walk and sit under it.',
  icon: '⛱️',
  category: 'Patio',
  placement: 'floor',
  mounting: 'floor',
  params: {
    woodColor: color('Wood colour', '#b8915f'),
    roofColor: color('Roof colour', '#dfe5e4'),
    width: length('Width', 3.2, 1.2, 6),
    depth: length('Depth', 2.6, 1, 4),
    height: length('Height at the facade', 2.45, 1.9, 3.2),
    frontHeight: length('Height at the posts', 2.15, 1.8, 3),
    posts: count('Posts', 2, 2, 4),
    post: fixedLength('Post size', 0.09),
  },
  snapping: { wall: 'back' },
  footprint: 'none',
});

export const table = defineType({
  id: 'garden.table',
  kind: 'outdoor',
  family: 'garden',
  name: 'Garden table',
  description: 'Patio table: a dark metal frame with a glass top.',
  icon: '🪑',
  category: 'Patio',
  placement: 'floor',
  mounting: 'floor',
  params: {
    frameColor: color('Frame colour', '#2f3234'),
    topColor: color('Top colour', '#8f9a9b'),
    width: length('Width', 1.4, 0.6, 2.4),
    depth: length('Depth', 0.8, 0.6, 1.2),
    height: length('Height', 0.74, 0.65, 0.8),
  },
  snapping: { wall: 'none' },
  footprint: 'rectangle',
});

export const chair = defineType({
  id: 'garden.chair',
  kind: 'outdoor',
  family: 'garden',
  name: 'Garden chair',
  description: 'Stackable patio chair: a dark metal frame with a mesh seat and a high backrest.',
  icon: '🪑',
  category: 'Patio',
  placement: 'floor',
  mounting: 'floor',
  params: {
    color: color('Colour', '#2f3234'),
    width: length('Width', 0.58, 0.45, 0.7),
    depth: length('Depth', 0.62, 0.5, 0.75),
    height: length('Height', 1.05, 0.8, 1.2),
    seat: fixedLength('Seat height', 0.45),
  },
  snapping: { wall: 'none' },
  footprint: 'rectangle',
});

export const bench = defineType({
  id: 'garden.bench',
  kind: 'outdoor',
  family: 'garden',
  name: 'Garden bench',
  description: 'A wooden slatted bench with a backrest, against a wall or free-standing.',
  icon: '🪑',
  category: 'Patio',
  placement: 'floor',
  mounting: 'floor',
  params: {
    color: color('Colour', '#8e8a82'),
    width: length('Width', 1.2, 0.8, 2.4),
    depth: length('Depth', 0.55, 0.4, 0.7),
    height: length('Height', 0.85, 0.7, 1),
    seat: fixedLength('Seat height', 0.45),
  },
  snapping: { wall: 'back' },
  footprint: 'rectangle',
});

export const planter = defineType({
  id: 'garden.planter',
  kind: 'outdoor',
  family: 'garden',
  name: 'Planter',
  description: 'Tall pot (zinc, terracotta, …) with a plant in it, such as lavender.',
  icon: '🪴',
  category: 'Plants',
  placement: 'floor',
  mounting: 'floor',
  params: {
    color: color('Pot colour', '#8c9295'),
    plantColor: color('Plant colour', '#7e8e6c'),
    diameter: length('Diameter', 0.38, 0.2, 1),
    height: length('Pot height', 0.5, 0.15, 1),
    plantHeight: length('Plant height', 0.4, 0, 1.2),
    shape: choice('Shape', { round: 'Round', square: 'Square' }),
  },
  snapping: { wall: 'none' },
  footprint: 'ellipse',
});

export const shrub = defineType({
  id: 'garden.shrub',
  kind: 'outdoor',
  family: 'garden',
  name: 'Shrub',
  description: 'A bush on the ground; with flowers it is a rose bush.',
  icon: '🌹',
  category: 'Plants',
  placement: 'floor',
  mounting: 'floor',
  params: {
    leafColor: color('Leaf colour', '#4c6b3b'),
    flowers: choice('Flowers', { none: 'None', roses: 'Roses' }),
    flowerColor: color('Flower colour', '#c23b4e'),
    diameter: length('Diameter', 0.9, 0.3, 3),
    height: length('Height', 1.1, 0.3, 3),
  },
  snapping: { wall: 'none' },
  footprint: 'ellipse',
});

export const grass = defineType({
  id: 'garden.grass',
  kind: 'outdoor',
  family: 'garden',
  name: 'Ornamental grass',
  description: 'A clump of tall ornamental grass.',
  icon: '🌾',
  category: 'Plants',
  placement: 'floor',
  mounting: 'floor',
  params: {
    color: color('Colour', '#9aa66b'),
    diameter: length('Diameter', 0.6, 0.2, 1.5),
    height: length('Height', 1.2, 0.3, 2.5),
  },
  snapping: { wall: 'none' },
  footprint: 'ellipse',
});

export const hedge = defineType({
  id: 'garden.hedge',
  kind: 'outdoor',
  family: 'garden',
  name: 'Hedge',
  description:
    'A clipped hedge in a straight run. Several in a row, or at an angle, follow a border.',
  icon: '🌳',
  category: 'Plants',
  placement: 'floor',
  mounting: 'floor',
  params: {
    color: color('Leaf colour', '#3f5f35'),
    width: length('Length', 2, 0.5, 12),
    depth: length('Depth', 0.6, 0.3, 1.5),
    height: length('Height', 1.5, 0.4, 3),
  },
  snapping: { wall: 'none' },
  footprint: 'rectangle',
});

export const tree = defineType({
  id: 'garden.tree',
  kind: 'outdoor',
  family: 'garden',
  name: 'Tree',
  description: 'A broadleaved tree: a trunk and a round crown. Open: you walk and sit under it.',
  icon: '🌲',
  category: 'Plants',
  placement: 'floor',
  mounting: 'floor',
  params: {
    leafColor: color('Leaf colour', '#4f7038'),
    trunkColor: color('Trunk colour', '#5b4a3a'),
    diameter: length('Crown diameter', 3.5, 1, 8),
    height: length('Height', 5, 2, 12),
    trunkHeight: length('Clear trunk', 1.8, 0.3, 4),
  },
  snapping: { wall: 'none' },
  footprint: 'none',
});

export const rockPile = defineType({
  id: 'garden.rock-pile',
  kind: 'outdoor',
  family: 'garden',
  name: 'Dry-stone pile',
  description:
    'Natural stones heaped without mortar: a rubble bank, a low dry-stone wall or a rockery.',
  icon: '🪨',
  category: 'Stone & wood',
  placement: 'floor',
  mounting: 'floor',
  params: {
    color: color('Stone colour', '#9b9a93'),
    width: length('Length', 1.6, 0.4, 6),
    depth: length('Depth', 0.8, 0.3, 3),
    height: length('Height', 0.6, 0.2, 1.5),
  },
  snapping: { wall: 'any' },
  footprint: 'rectangle',
});

export const steppingStone = defineType({
  id: 'garden.stepping-stone',
  kind: 'outdoor',
  family: 'garden',
  name: 'Stepping stone',
  description: 'A round slab set into the lawn; you walk over it.',
  icon: '⚪',
  category: 'Stone & wood',
  placement: 'floor',
  mounting: 'floor',
  params: {
    color: color('Colour', '#b9b5ac'),
    diameter: length('Diameter', 0.45, 0.25, 1),
    height: fixedLength('Thickness', 0.03),
  },
  snapping: { wall: 'none' },
  footprint: 'none',
});

export const log = defineType({
  id: 'garden.log',
  kind: 'outdoor',
  family: 'garden',
  name: 'Log',
  description: 'A tree trunk section lying on the ground, as a decoration.',
  icon: '🪵',
  category: 'Stone & wood',
  placement: 'floor',
  mounting: 'floor',
  params: {
    color: color('Bark colour', '#7d6d5b'),
    width: length('Length', 0.8, 0.3, 2),
    diameter: length('Diameter', 0.35, 0.15, 0.8),
  },
  snapping: { wall: 'any' },
  footprint: 'rectangle',
});

export const birdHouse = defineType({
  id: 'garden.bird-house',
  kind: 'outdoor',
  family: 'garden',
  name: 'Bird house',
  description: 'A wooden bird house with a two-tier roof on a three-legged stand.',
  icon: '🐦',
  category: 'Garden',
  placement: 'floor',
  mounting: 'floor',
  params: {
    color: color('Wood colour', '#c9773c'),
    roofColor: color('Roof colour', '#6e7377'),
    height: length('Height', 1.5, 0.8, 2),
    diameter: fixedLength('Stand width', 0.6),
  },
  snapping: { wall: 'none' },
  footprint: 'ellipse',
});

export const bin = defineType({
  id: 'garden.bin',
  kind: 'outdoor',
  family: 'garden',
  name: 'Wheelie bin',
  description:
    'A plastic waste bin on two wheels, its hinged lid and handle at the back; 240 litres by default.',
  icon: '🗑️',
  category: 'Garden',
  placement: 'floor',
  mounting: 'floor',
  params: {
    color: color('Colour', '#232325'),
    width: length('Width', 0.58, 0.45, 0.8),
    depth: length('Depth', 0.73, 0.5, 1.1),
    height: length('Height', 1.07, 0.85, 1.3),
    wheelColor: color('Wheel colour', '#1a1a1b', 'design'),
  },
  snapping: { wall: 'back' },
  footprint: 'rectangle',
});

export const pillar = defineType({
  id: 'garden.pillar',
  kind: 'outdoor',
  family: 'garden',
  name: 'Brick pillar',
  description:
    'A square pillar of clinker bricks with a concrete cap, at the end of a fence or beside a gate.',
  icon: '🧱',
  category: 'Stone & wood',
  placement: 'floor',
  mounting: 'floor',
  params: {
    color: color('Brick colour', '#634539'),
    capColor: color('Cap colour', '#9b928e'),
    diameter: length('Width', 0.49, 0.24, 1),
    height: length('Height', 1.2, 0.4, 2.5),
  },
  snapping: { wall: 'any' },
  footprint: 'rectangle',
});

export const kerb = defineType({
  id: 'garden.kerb',
  kind: 'outdoor',
  family: 'garden',
  name: 'Concrete kerb',
  description:
    'A low concrete edging along a bed, a lawn or a drive, its top edges bevelled; you step over it.',
  icon: '➖',
  category: 'Stone & wood',
  placement: 'floor',
  mounting: 'floor',
  params: {
    color: color('Colour', '#a89e8c'),
    width: length('Length', 1, 0.3, 15),
    depth: length('Thickness', 0.15, 0.06, 0.4),
    height: length('Height', 0.25, 0.08, 0.8),
  },
  snapping: { wall: 'none' },
  footprint: 'none',
});

export const garden = [
  pergola,
  table,
  chair,
  bench,
  planter,
  shrub,
  grass,
  hedge,
  tree,
  rockPile,
  steppingStone,
  log,
  birdHouse,
  bin,
  pillar,
  kerb,
];
