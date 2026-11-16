import { describe, expect, it } from 'vitest';
import { mockHome } from '../test/fixtures';
import { findCollisions } from './collision';
import { floorPlan } from './floorPlan';
import { rectangle, transform } from './geometry';

const plan = floorPlan(mockHome, 'souterrain')!;
const box = (id: string, at: [number, number], w = 1, d = 1, r = 0) => ({
  id,
  polygon: transform(rectangle(w, d), at, r),
});

describe('findCollisions', () => {
  it('flags overlapping items, both ways', () => {
    const result = findCollisions(
      [box('a', [-3, 2.5]), box('b', [-2.5, 2.5]), box('c', [-1.5, 3.4])],
      [],
    );
    expect(result.get('a')).toEqual({ itemIds: ['b'], wallIds: [] });
    expect(result.get('b')?.itemIds).toEqual(['a']);
    expect(result.has('c')).toBe(false);
  });

  it('ignores items that only touch', () => {
    expect(findCollisions([box('a', [-3, 2.5]), box('b', [-2, 2.5])], []).size).toBe(0);
  });

  it('flags items overlapping a wall, but not flush against it', () => {
    // The living/bedroom wall runs along z = 1 and is 12 cm thick.
    expect(findCollisions([box('a', [-3, 1.2])], plan.walls).get('a')?.wallIds).toEqual([
      'souterrain-wall-living-bedroom',
    ]);
    expect(findCollisions([box('a', [-3, 1.56])], plan.walls).size).toBe(0);
  });

  it('lets items stand in a doorway but not in a window parapet', () => {
    // Bedroom door: z 2.0-2.9 in the hall wall at x = -0.5.
    expect(findCollisions([box('a', [-0.5, 2.45], 0.3, 0.5)], plan.walls).size).toBe(0);
    expect(findCollisions([box('a', [-0.5, 3.4], 0.3, 0.5)], plan.walls).size).toBe(1);
    // Bedroom window (sill 1.4 m) in the front wall: the wall below it is solid.
    expect(findCollisions([box('a', [-3.3, 3.9], 0.5, 0.5)], plan.walls).size).toBe(1);
  });
});
