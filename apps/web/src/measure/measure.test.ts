import { describe, expect, it } from 'vitest';
import { distance, metres, NO_MEASUREMENT, status, withPoint, type Point } from './measure';

describe('the measure tool (HUD v2 #206)', () => {
  it('measures the straight line between two known points, in metres', () => {
    expect(distance([0, 0, 0], [3, 0, 4])).toBe(5);
    // A floor corner to the ceiling corner opposite: the space diagonal.
    expect(distance([1, -2.6, 2], [3, 0, 5])).toBeCloseTo(Math.hypot(2, 2.6, 3));
    expect(metres(distance([0, 0, 0], [3, 0, 4]))).toBe('5.00 m');
  });

  it('writes centimetres with a real minus sign, and no negative zero', () => {
    expect(metres(1.234)).toBe('1.23 m');
    expect(metres(-0.25)).toBe('−0.25 m');
    expect(metres(-0.001)).toBe('0.00 m');
  });

  it('closes a span with the second point and starts again with a third', () => {
    const a: Point = [0, 0, 0];
    const b: Point = [1, 0, 0];
    const c: Point = [0, 2, 0];
    let m = withPoint(NO_MEASUREMENT, a);
    expect(m).toEqual([a]);
    m = withPoint(m, b);
    expect(m).toEqual([a, b]);
    expect(withPoint(m, c)).toEqual([c]);
  });

  it('says what to do next, and that a miss changed nothing', () => {
    expect(status(NO_MEASUREMENT, false)).toBe('Pick the first point.');
    expect(status([[0, 0, 0]], false)).toBe('Pick the second point.');
    expect(
      status(
        [
          [0, 0, 0],
          [0, 0, 2.5],
        ],
        false,
      ),
    ).toBe('Distance 2.50 m.');
    expect(status([[0, 0, 0]], true)).toMatch(/Nothing of the model there/);
  });
});
