import { defineType } from '../types';
import { color, fixedLength, length } from './specs';

// Drawn by the piece modules in apps/web/src/catalog/furniture/<name>/index.ts.

export const bed = defineType({
  id: 'furniture.bed',
  kind: 'furniture',
  family: 'furniture',
  name: 'Bed',
  description: 'Double bed; the headboard is its back.',
  icon: '🛏️',
  category: 'Bed room',
  placement: 'floor',
  params: {
    color: color('Colour', '#8a6a4a'),
    width: length('Width', 1.6, 0.8, 2.2),
    length: length('Length', 2.0, 1.9, 2.2),
    height: fixedLength('Height', 0.5),
    mattressColor: color('Mattress colour', '#f2efe8', 'design'),
    pillowColor: color('Pillow colour', '#ffffff', 'design'),
  },
  snapping: { wall: 'back' },
  footprint: 'rectangle',
});

export const sofa = defineType({
  id: 'furniture.sofa',
  kind: 'furniture',
  family: 'furniture',
  name: 'Sofa',
  description: 'Three-seater; the backrest is its back.',
  icon: '🛋️',
  category: 'Living room',
  placement: 'floor',
  params: {
    color: color('Colour', '#5b7a99'),
    width: length('Width', 2.0, 1.2, 3.2),
    depth: fixedLength('Depth', 0.9),
    height: fixedLength('Height', 0.85),
  },
  snapping: { wall: 'back' },
  footprint: 'rectangle',
});

export const table = defineType({
  id: 'furniture.table',
  kind: 'furniture',
  family: 'furniture',
  name: 'Round table',
  description: 'Round dining table on a single leg.',
  icon: '⭕',
  category: 'Dining',
  placement: 'floor',
  params: {
    color: color('Colour', '#b08a5e'),
    diameter: length('Diameter', 1.1, 0.6, 1.6),
    height: fixedLength('Height', 0.75),
  },
  snapping: { wall: 'none' },
  footprint: 'ellipse',
});

export const chair = defineType({
  id: 'furniture.chair',
  kind: 'furniture',
  family: 'furniture',
  name: 'Chair',
  description: 'Dining chair; the backrest is its back.',
  icon: '🪑',
  category: 'Dining',
  placement: 'floor',
  params: {
    color: color('Colour', '#9c7148'),
    width: fixedLength('Width', 0.45),
    depth: fixedLength('Depth', 0.5),
    height: fixedLength('Height', 0.9),
  },
  snapping: { wall: 'none' },
  footprint: 'rectangle',
});

export const wardrobe = defineType({
  id: 'furniture.wardrobe',
  kind: 'furniture',
  family: 'furniture',
  name: 'Wardrobe',
  description: 'Two-door wardrobe; stands with its back to a wall.',
  icon: '🚪',
  category: 'Bed room',
  placement: 'floor',
  params: {
    color: color('Colour', '#d9cbb3'),
    width: length('Width', 1.2, 0.5, 3.0),
    height: length('Height', 2.0, 1.6, 2.6),
    depth: fixedLength('Depth', 0.6),
  },
  snapping: { wall: 'back' },
  footprint: 'rectangle',
});

export const desk = defineType({
  id: 'furniture.desk',
  kind: 'furniture',
  family: 'furniture',
  name: 'Desk',
  description: 'Work desk; usually against a wall.',
  icon: '🖥️',
  category: 'Work room',
  placement: 'floor',
  params: {
    color: color('Colour', '#c9b18f'),
    width: length('Width', 1.4, 0.8, 2.2),
    depth: length('Depth', 0.7, 0.5, 0.9),
    height: fixedLength('Height', 0.75),
  },
  snapping: { wall: 'back' },
  footprint: 'rectangle',
});

export const furniture = [bed, sofa, table, chair, wardrobe, desk];

/** Today's furniture item ids (stored in layouts as `typeId`) and their catalogue types. */
export const LEGACY_FURNITURE_TYPE_IDS: Readonly<Record<string, string>> = Object.fromEntries(
  furniture.map((t) => [t.id.slice('furniture.'.length), t.id]),
);
