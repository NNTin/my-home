import { defineType } from '../types';
import { choice, color, count, finishChoice, fixedLength, length, number } from './specs';

// Drawn by the piece modules in apps/web/src/catalog/kitchen/<name>/index.ts. Sizes from the
// corridor survey (#60): the souterrain kitchen's units, wall cabinets, shelf and glass cabinet.

/** The longest run the types allow: the souterrain kitchen's north wall is about 3.4 m inside. */
const MAX_RUN = 4.2;

export const baseCabinet = defineType({
  id: 'kitchen.base-cabinet',
  kind: 'furniture',
  family: 'kitchen',
  name: 'Base cabinet run',
  description:
    'A run of base units under one worktop, on a plinth; doors or drawers, with an optional sink, hob and oven.',
  icon: '🗄️',
  category: 'Kitchen',
  placement: 'floor',
  mounting: 'floor',
  params: {
    frontColor: color('Front colour', '#c4c1ba'),
    worktopColor: color('Worktop colour', '#4b3a2d'),
    width: length('Run length', 2.4, 0.3, MAX_RUN),
    depth: length('Depth', 0.6, 0.45, 0.7),
    height: length('Worktop height', 0.9, 0.8, 0.96),
    unitWidth: length('Unit width', 0.6, 0.3, 1.2),
    fronts: choice('Fronts', {
      'drawer-door': 'Drawer over a door',
      doors: 'Doors',
      drawers: 'Three drawers',
    }),
    sink: choice('Sink', { none: 'None', single: 'Bowl with drainer' }),
    sinkAt: length('Sink centre from the left end', 0.9, 0.2, MAX_RUN),
    hob: choice('Hob', { none: 'None', induction: 'Induction', downdraft: 'Induction, downdraft' }),
    hobAt: length('Hob centre from the left end', 1.5, 0.2, MAX_RUN),
    oven: choice('Oven', { none: 'None', 'built-in': 'Built-in' }),
    ovenAt: length('Oven centre from the left end', 1.5, 0.3, MAX_RUN),
    plinth: fixedLength('Plinth height', 0.1),
    worktop: fixedLength('Worktop thickness', 0.04),
    carcassColor: color('Carcass colour', '#efeee9', 'design'),
    handleColor: color('Handle colour', '#3a3a3a', 'design'),
    sinkColor: color('Sink colour', '#2e2e2e', 'design'),
    hobColor: color('Hob glass colour', '#141414', 'design'),
    ovenColor: color('Oven colour', '#26282a', 'design'),
  },
  snapping: { wall: 'back' },
  footprint: 'rectangle',
});

export const wallCabinet = defineType({
  id: 'kitchen.wall-cabinet',
  kind: 'furniture',
  family: 'kitchen',
  name: 'Wall cabinet',
  description: 'Hangs on a wall; flat push-open doors or doors with bar handles.',
  icon: '🗃️',
  category: 'Kitchen',
  placement: 'floor',
  mounting: 'wall',
  elevation: 1.33,
  params: {
    frontColor: color('Front colour', '#b9b5ad'),
    carcassColor: color('Carcass colour', '#efeee9'),
    width: length('Width', 0.68, 0.3, 1.8),
    height: length('Height', 0.68, 0.3, 1.0),
    depth: length('Depth', 0.35, 0.25, 0.45),
    doors: count('Doors', 1, 1, 4),
    frontStyle: choice('Front style', { push: 'Push to open', handle: 'Bar handles' }),
    handleColor: color('Handle colour', '#3a3a3a', 'design'),
  },
  snapping: { wall: 'back' },
  footprint: 'rectangle',
});

export const wallShelf = defineType({
  id: 'kitchen.wall-shelf',
  kind: 'furniture',
  family: 'kitchen',
  name: 'Wall shelf',
  description: 'An open shelf board on a wall, with an optional rail and hooks below it.',
  icon: '🪵',
  category: 'Kitchen',
  placement: 'floor',
  mounting: 'wall',
  elevation: 1.52,
  params: {
    color: color('Colour', '#3d2c20'),
    // The board's finish, tinted with its colour: lacquer as it has always looked, or oak veneer.
    finish: finishChoice('Finish', ['plastic.matt', 'wood.veneer']),
    width: length('Length', 3.0, 0.3, MAX_RUN),
    depth: length('Depth', 0.25, 0.12, 0.4),
    height: length('Thickness', 0.03, 0.018, 0.06),
    rail: choice('Rail', { none: 'None', hooks: 'Rail with hooks' }),
    railDrop: fixedLength('Rail below the board', 0.12),
    railColor: color('Rail colour', '#1f1f1f', 'design'),
  },
  snapping: { wall: 'back' },
  footprint: 'rectangle',
});

export const tallCabinet = defineType({
  id: 'kitchen.tall-cabinet',
  kind: 'furniture',
  family: 'kitchen',
  name: 'Tall cabinet',
  description: 'Floor-to-head cabinet with one door, solid or smoked glass, and shelves inside.',
  icon: '🍷',
  category: 'Kitchen',
  placement: 'floor',
  mounting: 'floor',
  params: {
    carcassColor: color('Carcass colour', '#efeee9'),
    door: choice('Door', { glass: 'Glass', solid: 'Solid' }),
    glassColor: color('Glass colour', '#2b2f33'),
    frontColor: color('Door colour', '#efeee9'),
    width: length('Width', 0.5, 0.3, 0.9),
    height: length('Height', 1.99, 1.2, 2.4),
    depth: length('Depth', 0.48, 0.3, 0.65),
    shelves: number('Shelves', 4),
    glassOpacity: number('Glass opacity', 0.55),
  },
  snapping: { wall: 'back' },
  footprint: 'rectangle',
});

export const kitchen = [baseCabinet, wallCabinet, wallShelf, tallCabinet];
