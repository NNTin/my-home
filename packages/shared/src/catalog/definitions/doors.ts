import { defineType } from '../types';
import { color, count, fixedLength, number } from './specs';

/** Doors are drawn open: a frame without a sill and no leaf yet (`openingParts`). */
const doorFrameParams = {
  frameColor: color('Frame colour', '#7b5a3c'),
  frameWidth: fixedLength('Frame width', 0.06),
  frameDepth: fixedLength('Frame depth', 0.1),
};

export const interiorDoor = defineType({
  id: 'door.interior',
  kind: 'openings',
  family: 'door',
  name: 'Interior door',
  description: 'A door between two rooms, drawn open (frame only).',
  icon: '🚪',
  placement: 'wall',
  openingTypes: ['door'],
  preview: { width: 0.85, height: 2.0, sill: 0, wallDepth: 0.12 },
  params: doorFrameParams,
});

export const exteriorDoor = defineType({
  id: 'door.exterior',
  kind: 'openings',
  family: 'door',
  name: 'Exterior door',
  description: 'A door in an outside wall, drawn open (frame only).',
  icon: '🚪',
  placement: 'wall',
  openingTypes: ['door'],
  preview: { width: 1.0, height: 2.1, sill: 0, wallDepth: 0.36 },
  params: doorFrameParams,
});

export const frenchDoor = defineType({
  id: 'door.french',
  kind: 'openings',
  family: 'door',
  name: 'French door',
  description: 'A glazed door down to the floor.',
  icon: '🚪',
  placement: 'wall',
  openingTypes: ['french-door'],
  preview: { width: 1.0, height: 2.2, sill: 0, wallDepth: 0.36 },
  params: {
    frameColor: color('Frame colour', '#f7f7f5'),
    leaves: count('Leaves', 1, 1, 3, { minWidth: 0.4, one: 'leaf', other: 'leaves' }),
    frameWidth: fixedLength('Frame width', 0.06),
    frameDepth: fixedLength('Frame depth', 0.1),
    glassDepth: fixedLength('Glass thickness', 0.02),
    glassColor: color('Glass colour', '#a8d4ff', 'design'),
    glassOpacity: number('Glass opacity', 0.35),
  },
});

export const garageDoor = defineType({
  id: 'door.garage',
  kind: 'openings',
  family: 'door',
  name: 'Garage door',
  description: 'A closed garage door panel in a frame.',
  icon: '🚗',
  placement: 'wall',
  openingTypes: ['garage-door'],
  preview: { width: 2.5, height: 2.1, sill: 0, wallDepth: 0.24 },
  params: {
    frameColor: color('Frame colour', '#f7f7f5'),
    panelColor: color('Panel colour', '#8a8d90'),
    frameWidth: fixedLength('Frame width', 0.06),
    frameDepth: fixedLength('Frame depth', 0.1),
    panelDepth: fixedLength('Panel thickness', 0.04),
  },
});

export const doors = [interiorDoor, exteriorDoor, frenchDoor, garageDoor];
