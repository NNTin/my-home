import { defineType } from '../types';
import { choice, color, fixedLength, length } from './specs';

// The `fixtures` kind: built into the home, placed per environment like furniture (a placement
// each). Drawn by the piece modules in apps/web/src/catalog/fixture/<name>/index.ts.
//
// Every placed fixture keeps its placement id for good (`souterrain-downlight-3`: issued once,
// never reused, kept through moves, edits and the trash; docs/userdata.md), which is what a
// smart-home link can refer to. So a type id here never changes once used.

export const downlight = defineType({
  id: 'fixture.downlight',
  kind: 'fixtures',
  family: 'fixture',
  name: 'Downlight',
  description: 'Round recessed ceiling light; flush with the ceiling, its housing above it.',
  icon: '💡',
  category: 'Lighting',
  placement: 'floor',
  mounting: 'ceiling',
  params: {
    trimColor: color('Trim colour', '#f4f4f1'),
    diameter: length('Diameter', 0.085, 0.05, 0.2),
    light: choice('Light colour', {
      warm: 'Warm white (2700 K)',
      neutral: 'Neutral white (4000 K)',
      daylight: 'Daylight (6500 K)',
    }),
    height: fixedLength('Housing depth', 0.07),
    trim: fixedLength('Trim', 0.006),
  },
  snapping: { wall: 'none' },
  footprint: 'ellipse',
});

export const radiator = defineType({
  id: 'fixture.radiator',
  kind: 'fixtures',
  family: 'fixture',
  name: 'Panel radiator',
  description:
    'Compact panel radiator on wall brackets, with a top grille and a thermostat valve; one, two or three panels by its depth.',
  icon: '♨️',
  category: 'Heating',
  placement: 'floor',
  mounting: 'wall',
  elevation: 0.1,
  params: {
    color: color('Colour', '#f2f2ee'),
    width: length('Width', 0.75, 0.4, 2.0),
    height: length('Height', 0.6, 0.3, 0.9),
    depth: length('Depth from the wall', 0.14, 0.09, 0.2),
    valveSide: choice('Valve side', { right: 'Right', left: 'Left' }),
    wallGap: fixedLength('Gap to the wall', 0.04),
    valveColor: color('Valve colour', '#ffffff', 'design'),
  },
  snapping: { wall: 'back' },
  footprint: 'rectangle',
});

export const fixtures = [downlight, radiator];
