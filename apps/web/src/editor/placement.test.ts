import { describe, expect, it } from 'vitest';
import { mockHome } from '../test/fixtures';
import { floorPlan } from './floorPlan';
import { rectangle, transform, type Vec2 } from './geometry';
import { allowedArea, constrainMove, isInside, placementPosition, roomAt } from './placement';

const plan = floorPlan(mockHome, 'souterrain')!;
const square = (p: Vec2) => transform(rectangle(1, 1), p, 0);

describe('placement', () => {
  it('finds the room at a point', () => {
    expect(roomAt(plan, [-3, 2.5])?.id).toBe('souterrain-bedroom');
    expect(roomAt(plan, [0.5, 0])?.id).toBe('souterrain-hallway');
    expect(roomAt(plan, [20, 0])).toBeUndefined();
  });

  it('allows the whole apartment, or the footprint on a level without rooms', () => {
    expect(allowedArea(plan, [-3, 2.5])).toHaveLength(5);
    const upper = floorPlan(mockHome, 'first-floor')!;
    expect(allowedArea(upper, [0, 0])).toEqual([upper.footprint]);
  });

  it('accepts footprints spanning rooms of the apartment, not outside it', () => {
    const area = allowedArea(plan, [-3, 2.5]);
    expect(isInside(area, square([-0.5, 2.45]))).toBe(true);
    expect(isInside(area, square([-4.8, 2.5]))).toBe(false);
  });

  it('keeps moves inside, sliding along the boundary', () => {
    expect(constrainMove(plan, [-3, 2.5], [-3.5, 2], square)).toEqual([-3.5, 2]);
    // Through the west exterior wall: slides along z, x stays.
    expect(constrainMove(plan, [-3, 2.5], [-6, 2], square)).toEqual([-3, 2]);
    // Straight out of the building: stays put.
    expect(constrainMove(plan, [-4.5, 3.5], [-6, 6], square)).toEqual([-4.5, 3.5]);
  });

  it('lets an item that is already outside move back in', () => {
    expect(constrainMove(plan, [-5.2, 2.5], [-4.9, 2.5], square)).toEqual([-4.9, 2.5]);
  });

  it('places new items at the room centre, or the nearest free spot', () => {
    expect(placementPosition(plan, 'souterrain-bedroom', () => true)).toEqual([-2.75, 2.5]);
    const p = placementPosition(plan, 'souterrain-bedroom', ([x]) => x < -3);
    expect(p[0]).toBeLessThan(-3);
    expect(placementPosition(plan, 'nope', () => true)).toEqual([0, 0]);
  });
});
