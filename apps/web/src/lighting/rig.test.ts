import { describe, expect, it } from 'vitest';
import {
  backdropColors,
  backdropRequested,
  BACKDROPS,
  environmentIntensity,
  rigFor,
  type RigView,
} from './rig';

const VIEWS: RigView[] = [
  { kind: 'free' },
  { kind: 'eye' },
  { kind: 'cutaway' },
  { kind: 'section', look: 'north' },
  { kind: 'section', look: 'east' },
  { kind: 'section', look: 'south' },
  { kind: 'section', look: 'west' },
];

describe('the light rig', () => {
  it('is daylight for every view: a sun above, lamps on, an environment', () => {
    for (const view of VIEWS) {
      const rig = rigFor(view);
      expect(rig.sun.direction[1]).toBeGreaterThan(0);
      expect(rig.sun.intensity).toBeGreaterThan(0);
      expect(rig.environment).toBeGreaterThan(0);
      expect(rig.lamps.on).toBe(true);
      expect(rig.exposure).toBe(1);
    }
  });

  it('keeps the free view its sun and its sky', () => {
    const rig = rigFor({ kind: 'free' });
    expect(rig.sun.direction).toEqual([20, 30, 15]);
    expect(rig.backdrop).toBe('sky');
    expect(backdropColors('sky', false)).toEqual({ top: '#cfdde8', bottom: '#cfdde8' });
  });

  it('lowers the environment under a ceiling by the interior factor', () => {
    const rig = rigFor({ kind: 'eye' });
    expect(rig.interior).toBe(0.3);
    expect(environmentIntensity(rig, true)).toBeCloseTo(rig.environment * 0.3, 9);
    expect(environmentIntensity(rig, false)).toBe(rig.environment);
  });

  it('puts the sun of a section behind the camera, so the cut faces it looks at are lit', () => {
    // Looking north (-z) the camera stands in the south (+z); looking east (+x), in the west.
    expect(rigFor({ kind: 'section', look: 'north' }).sun.direction[2]).toBeGreaterThan(0);
    expect(rigFor({ kind: 'section', look: 'south' }).sun.direction[2]).toBeLessThan(0);
    expect(rigFor({ kind: 'section', look: 'east' }).sun.direction[0]).toBeLessThan(0);
    expect(rigFor({ kind: 'section', look: 'west' }).sun.direction[0]).toBeGreaterThan(0);
  });

  it('gives the named views the light studio backdrop', () => {
    expect(rigFor({ kind: 'cutaway' }).backdrop).toBe('studio-light');
    expect(rigFor({ kind: 'section', look: 'north' }).backdrop).toBe('studio-light');
  });

  it('has three backdrops, flat from outside and a gradient at eye level', () => {
    expect(BACKDROPS).toEqual(['sky', 'studio-light', 'studio-dark']);
    for (const backdrop of BACKDROPS) {
      const flat = backdropColors(backdrop, false);
      expect(flat.top).toBe(flat.bottom);
      const eye = backdropColors(backdrop, true);
      expect(eye.top).not.toBe(eye.bottom);
    }
  });

  it('reads the backdrop from the URL', () => {
    expect(backdropRequested('?backdrop=studio-dark')).toBe('studio-dark');
    expect(backdropRequested('?backdrop=night')).toBeUndefined();
    expect(backdropRequested('')).toBeUndefined();
  });
});
