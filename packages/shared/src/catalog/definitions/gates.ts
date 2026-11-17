import { defineType } from '../types';
import { color, fixedLength } from './specs';

/** A gate is a fence of `kind: 'gate'`: posts and level panels (`buildFence` in the web builder). */
export const swingGate = defineType({
  id: 'gate.swing',
  kind: 'openings',
  family: 'gate',
  name: 'Swing gate',
  description: 'A framed gate leaf between metal posts in a fence line.',
  icon: '⛩️',
  placement: 'fence',
  preview: { width: 1.0, height: 1.2, sill: 0, wallDepth: 0.1 },
  params: {
    color: color('Colour', '#6c7176'),
    postColor: color('Post colour', '#3d4043'),
    postSize: fixedLength('Post size', 0.1),
    postExtra: fixedLength('Post above the panel', 0.1),
    panelDepth: fixedLength('Panel thickness', 0.04),
    bay: fixedLength('Largest bay', 2.5),
  },
});

export const gates = [swingGate];
