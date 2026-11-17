import { describe, expect, it } from 'vitest';
import { initialCamera } from './Scene';

const bounds = { min: [-10, 0, -6], max: [10, 8, 6] } as Parameters<typeof initialCamera>[0];

describe('initialCamera', () => {
  it('stands south-east of the building, above it', () => {
    // 20 m wide: 11 m east, 9 m above the top, 15 m south of the middle.
    expect(initialCamera(bounds)).toEqual([11, 17, 15]);
    // A wide view (a desktop window, a phone held across) needs no more distance.
    expect(initialCamera(bounds, 1.6)).toEqual(initialCamera(bounds));
  });

  it('stands further back for a view that is narrower than it is high', () => {
    // Half as wide as high: twice as far.
    expect(initialCamera(bounds, 0.5)).toEqual([22, 26, 30]);
  });

  it('treats a view that is not measured yet as a wide one', () => {
    for (const aspect of [0, NaN, Infinity, -1])
      expect(initialCamera(bounds, aspect)).toEqual(initialCamera(bounds));
  });
});
