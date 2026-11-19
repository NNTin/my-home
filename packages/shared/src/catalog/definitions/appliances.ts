import { defineType } from '../types';
import { color, fixedLength, length } from './specs';

// Drawn by the piece modules in apps/web/src/catalog/appliance/<name>/index.ts. Sizes from the
// corridor survey (#60).

export const fridgeFreezer = defineType({
  id: 'appliance.fridge-freezer',
  kind: 'furniture',
  family: 'appliance',
  name: 'Fridge-freezer',
  description: 'Freestanding, the freezer at the bottom; the doors are its front.',
  icon: '🧊',
  category: 'Kitchen',
  placement: 'floor',
  mounting: 'floor',
  params: {
    color: color('Colour', '#b9bdc1'),
    width: length('Width', 0.6, 0.5, 0.75),
    height: length('Height', 1.85, 1.2, 2.05),
    depth: length('Depth', 0.65, 0.55, 0.75),
    freezer: fixedLength('Freezer door height', 0.7),
    handleColor: color('Handle colour', '#8e9296', 'design'),
  },
  snapping: { wall: 'back' },
  footprint: 'rectangle',
});

export const microwave = defineType({
  id: 'appliance.microwave',
  kind: 'furniture',
  family: 'appliance',
  name: 'Microwave',
  description: 'Freestanding, on the worktop; the door with its window is its front.',
  icon: '📟',
  category: 'Kitchen',
  placement: 'floor',
  mounting: 'floor',
  elevation: 0.9,
  params: {
    color: color('Colour', '#2a2a2a'),
    width: length('Width', 0.48, 0.4, 0.6),
    height: length('Height', 0.28, 0.24, 0.36),
    depth: length('Depth', 0.38, 0.3, 0.5),
    glassColor: color('Window colour', '#111315', 'design'),
    panelColor: color('Control panel colour', '#5d6166', 'design'),
  },
  snapping: { wall: 'back' },
  footprint: 'rectangle',
});

export const appliances = [fridgeFreezer, microwave];
