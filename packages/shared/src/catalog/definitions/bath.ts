import { defineType } from '../types';
import { choice, color, count, fixedLength, length } from './specs';

// The bath room's sanitary ware and what is built around it. Drawn by the piece modules in
// apps/web/src/catalog/bath/<name>/index.ts. Sizes from the owner's photos of the souterrain
// bath room (#146): 2505beb2, 5726165a, c3d258bf.

/** Which side of a corner piece stands at the second wall: the back is always at a wall. */
const corner = choice('Corner', { left: 'Wall on the left', right: 'Wall on the right' });

export const cornerTub = defineType({
  id: 'bath.corner-tub',
  kind: 'furniture',
  family: 'bath',
  name: 'Corner bathtub',
  description:
    'A bathtub for a corner, its back and one side at the walls, with a rounded apron in front.',
  icon: '🛁',
  category: 'Bath room',
  placement: 'floor',
  mounting: 'floor',
  params: {
    apronColor: color('Apron colour', '#5f6266'),
    width: length('Width', 1.4, 1.2, 1.7),
    depth: length('Depth', 1.4, 1.2, 1.7),
    height: length('Rim height', 0.58, 0.45, 0.7),
    corner,
    rim: fixedLength('Rim width', 0.07),
    bowl: fixedLength('Bowl depth', 0.42),
  },
  snapping: { wall: 'back' },
  footprint: 'rectangle',
});

export const shower = defineType({
  id: 'bath.shower',
  kind: 'furniture',
  family: 'bath',
  name: 'Walk-in shower',
  description:
    'A level shower in a corner: glass in front and on one side, a rail with a head and a hand shower at the back wall.',
  icon: '🚿',
  category: 'Bath room',
  placement: 'floor',
  mounting: 'floor',
  params: {
    width: length('Width', 0.9, 0.7, 1.8),
    depth: length('Depth', 0.9, 0.7, 1.8),
    height: length('Glass height', 2.0, 1.8, 2.2),
    corner,
    glassColor: color('Glass colour', '#dfeaf0', 'design'),
    metalColor: color('Fittings colour', '#c3c7cb', 'design'),
  },
  snapping: { wall: 'back' },
  footprint: 'rectangle',
});

export const toilet = defineType({
  id: 'bath.toilet',
  kind: 'furniture',
  family: 'bath',
  name: 'Wall-hung toilet',
  description: 'Hangs on a wall, clear of the floor, with its flush plate on the wall above it.',
  icon: '🚽',
  category: 'Bath room',
  placement: 'floor',
  mounting: 'wall',
  elevation: 0.08,
  params: {
    depth: length('Depth from the wall', 0.54, 0.48, 0.6),
    width: fixedLength('Width', 0.36),
    height: fixedLength('Height', 0.35),
    plate: fixedLength('Flush plate above the seat', 0.58),
    plateColor: color('Flush plate colour', '#f2f2f0', 'design'),
  },
  snapping: { wall: 'back' },
  footprint: 'rectangle',
});

export const vanity = defineType({
  id: 'bath.vanity',
  kind: 'furniture',
  family: 'bath',
  name: 'Washbasin cabinet',
  description: 'A wall-hung cabinet with drawers under a ceramic washbasin with its tap.',
  icon: '🚰',
  category: 'Bath room',
  placement: 'floor',
  mounting: 'wall',
  elevation: 0.3,
  params: {
    color: color('Colour', '#f4f4f2'),
    width: length('Width', 0.6, 0.4, 1.4),
    depth: length('Depth', 0.46, 0.35, 0.55),
    height: length('Height', 0.55, 0.35, 0.7),
    drawers: count('Drawers', 2, 1, 3),
    basin: fixedLength('Basin thickness', 0.05),
    handleColor: color('Handle colour', '#b9bdc1', 'design'),
  },
  snapping: { wall: 'back' },
  footprint: 'rectangle',
});

export const ledge = defineType({
  id: 'bath.ledge',
  kind: 'furniture',
  family: 'bath',
  name: 'Tiled ledge',
  description:
    'A tiled wall in front of a wall, with a shelf on top: behind a bathtub, under a window, around pipes.',
  icon: '🧱',
  category: 'Bath room',
  placement: 'floor',
  mounting: 'floor',
  params: {
    color: color('Tile colour', '#ded5cc'),
    topColor: color('Top colour', '#8f8b86'),
    width: length('Length', 2.0, 0.3, 4.0),
    depth: length('Depth', 0.2, 0.08, 0.6),
    height: length('Height', 1.05, 0.2, 2.3),
    top: fixedLength('Top thickness', 0.012),
  },
  snapping: { wall: 'back' },
  footprint: 'rectangle',
});

export const bath = [cornerTub, shower, toilet, vanity, ledge];
