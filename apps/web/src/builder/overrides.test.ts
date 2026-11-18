import { describe, expect, it } from 'vitest';
import { mockHome } from '../test/fixtures';
import { buildHome } from './buildHome';

const WINDOW = 'souterrain-kitchen-window';
const windowOf = (scene: ReturnType<typeof buildHome>) =>
  scene.openings.find((o) => o.id === WINDOW)!;

describe('buildHome with opening overrides', () => {
  it('draws the frame in an overridden colour', () => {
    const plain = windowOf(buildHome(mockHome));
    const dark = windowOf(buildHome(mockHome, new Map([[WINDOW, { frameColor: '#383e42' }]])));
    const frames = (o: typeof plain) => o.parts.filter((p) => p.role === 'frame');
    expect(frames(plain).every((p) => p.color === '#f7f7f5')).toBe(true);
    expect(frames(dark).length).toBe(frames(plain).length);
    expect(frames(dark).every((p) => p.color === '#383e42')).toBe(true);
    // Only that window.
    const other = (s: ReturnType<typeof buildHome>) =>
      s.openings.find((o) => o.id === 'souterrain-bedroom-window')!.parts;
    expect(other(buildHome(mockHome, new Map([[WINDOW, { frameColor: '#383e42' }]])))).toEqual(
      other(buildHome(mockHome)),
    );
  });

  it('adds a mullion for a second sash, and ignores invalid overrides', () => {
    const plain = windowOf(buildHome(mockHome));
    const two = windowOf(buildHome(mockHome, new Map([[WINDOW, { sashes: 2 }]])));
    const frames = (o: typeof plain) => o.parts.filter((p) => p.role === 'frame').length;
    expect(frames(two)).toBe(frames(plain) + 1);
    expect(two.values.sashes).toBe(2);
    const invalid = windowOf(
      buildHome(mockHome, new Map([[WINDOW, { sashes: 99, frameColor: 'red', frameWidth: 1 }]])),
    );
    expect(invalid.parts).toEqual(plain.parts);
  });
});
