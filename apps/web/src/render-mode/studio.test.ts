import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { STUDIO_PANELS } from '../lighting/environment';
import { studioEquirect, studioRadiance } from './studio';

describe('the studio environment for the tracer', () => {
  it('shows the soft box overhead, the wall panels, the walls and the floor', () => {
    const top = Math.max(...STUDIO_PANELS.map((p) => p.radiance));
    expect(studioRadiance(new Vector3(0, 1, 0))).toBe(top);
    // Level, towards the middle of each wall: its panel.
    for (const [x, z] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const)
      expect(studioRadiance(new Vector3(x, 0, z))).toBe(1.1);
    // Into a corner, level: the wall between two panels.
    expect(studioRadiance(new Vector3(1, 0, 1).normalize())).toBe(0.55);
    expect(studioRadiance(new Vector3(0, -1, 0))).toBe(0.3);
  });

  it('is an equirectangular float texture, darker below than above', () => {
    const texture = studioEquirect(32, 16);
    expect([texture.image.width, texture.image.height]).toEqual([32, 16]);
    const data = texture.image.data as Float32Array;
    expect(data).toHaveLength(32 * 16 * 4);
    // The first row looks down at the floor, the last one up into the soft box.
    expect(data[0]).toBeCloseTo(0.3, 6);
    expect(data[(15 * 32 + 5) * 4]).toBeCloseTo(2.2, 6);
    expect(data[3]).toBe(1);
  });
});
