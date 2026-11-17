import { defineType } from '../types';
import { color, count, fixedLength, number } from './specs';

/** Frame and pane of today's wall windows (`openingParts` in the web builder). */
const wallWindowParams = {
  frameColor: color('Frame colour', '#f7f7f5'),
  sashes: count('Sashes', 1, 1, 4, { minWidth: 0.25, one: 'sash', other: 'sashes' }),
  frameWidth: fixedLength('Frame width', 0.06),
  frameDepth: fixedLength('Frame depth', 0.1),
  glassDepth: fixedLength('Glass thickness', 0.02),
  glassColor: color('Glass colour', '#a8d4ff', 'design'),
  glassOpacity: number('Glass opacity', 0.35),
};

const wallWindowPreview = { width: 1.2, height: 1.2, sill: 0.9, wallDepth: 0.36 };

export const casementWindow = defineType({
  id: 'window.casement',
  kind: 'openings',
  family: 'window',
  name: 'Casement window',
  description: 'A window whose sashes swing open on side hinges.',
  icon: '🪟',
  placement: 'wall',
  openingTypes: ['window'],
  preview: wallWindowPreview,
  params: wallWindowParams,
});

export const tiltTurnWindow = defineType({
  id: 'window.tilt-turn',
  kind: 'openings',
  family: 'window',
  name: 'Tilt-and-turn window',
  description: 'A window whose sashes tilt in at the top or swing open on side hinges.',
  icon: '🪟',
  placement: 'wall',
  openingTypes: ['window'],
  preview: wallWindowPreview,
  params: wallWindowParams,
});

export const roofWindow = defineType({
  id: 'window.roof',
  kind: 'openings',
  family: 'window',
  name: 'Roof window',
  description: 'A window lying in a roof plane (no frame is drawn yet).',
  icon: '🔲',
  placement: 'roof',
  preview: { width: 0.8, height: 1.2, sill: 0, wallDepth: 0.06 },
  params: {
    glassColor: color('Glass colour', '#a8d4ff'),
    thickness: fixedLength('Thickness', 0.06),
    metalness: number('Metalness', 0.3),
    roughness: number('Roughness', 0.2),
  },
});

export const windows = [casementWindow, tiltTurnWindow, roofWindow];
