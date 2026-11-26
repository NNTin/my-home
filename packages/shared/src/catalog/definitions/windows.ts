import { defineType } from '../types';
import { choice, color, count, fixedLength, fraction, number } from './specs';

/**
 * The standard German uPVC window (`catalog/openings/window.ts` in the web app): a frame
 * (Blendrahmen) set back in the wall, a sash (Flügel) per division with its glass, a handle on the
 * sash's opening side, an inside window board (Fensterbank innen) and an outside sill (Fensterbank
 * außen). Optional per use: a roller shutter (Rollladen) with its box outside on the facade or inside
 * over the window, and a curtain on a rod in the room. "Left" and "right" are as seen from the room.
 */
const wallWindowParams = {
  frameColor: color('Frame colour', '#f7f7f5'),
  sashes: count('Sashes', 1, 1, 4, { minWidth: 0.25, one: 'sash', other: 'sashes' }),
  handleSide: choice('Handle', { right: 'Right', left: 'Left' }),
  boardColor: color('Window board colour', '#ebe8e1'),
  shutter: choice('Roller shutter', { none: 'None', outside: 'Box outside', inside: 'Box inside' }),
  shutterClosed: fraction('Shutter closed', 0),
  shutterColor: color('Shutter colour', '#e9e6de'),
  curtain: choice('Curtain', { none: 'None', both: 'Both sides', left: 'Left', right: 'Right' }),
  curtainClosed: fraction('Curtain closed', 0),
  curtainColor: color('Curtain colour', '#9ea596'),
  frameWidth: fixedLength('Frame width', 0.065),
  frameDepth: fixedLength('Frame depth', 0.07),
  sashWidth: fixedLength('Sash width', 0.06),
  sashDepth: fixedLength('Sash depth', 0.078),
  frameSetback: fixedLength('Frame set back from the outside', 0.12),
  glassDepth: fixedLength('Glass thickness', 0.024),
  glassColor: color('Glass colour', '#a8d4ff', 'design'),
  glassOpacity: number('Glass opacity', 0.35),
  handleColor: color('Handle colour', '#e4e4e0', 'design'),
  boardThickness: fixedLength('Window board thickness', 0.03),
  boardOverhang: fixedLength('Window board overhang', 0.03),
  sillColor: color('Outside sill colour', '#9c9fa3', 'design'),
  sillOverhang: fixedLength('Outside sill overhang', 0.05),
  shutterBoxHeight: fixedLength('Shutter box height', 0.2),
  shutterBoxDepth: fixedLength('Shutter box depth', 0.18),
  curtainRodColor: color('Curtain rod colour', '#2b2b2b', 'design'),
  curtainRodHeight: fixedLength('Curtain rod above the opening', 0.15),
  curtainRodReach: fixedLength('Curtain rod beyond the opening', 0.25),
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
  description: 'A window lying in a roof plane, in a frame of dark cladding.',
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
