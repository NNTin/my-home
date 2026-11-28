import { describe, expect, it } from 'vitest';
import {
  angleDiff,
  centroid,
  convexOverlap,
  ellipse,
  normalizeAngle,
  pointInPolygon,
  rectangle,
  rotate,
  transform,
} from './geometry';

const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!));

describe('geometry', () => {
  it('rotates like three.js rotation.y (counter-clockwise seen from above)', () => {
    // +90° turns local +x (east) to -z (north) and local +z (front) to +x.
    close(rotate([1, 0], Math.PI / 2), [0, -1]);
    close(rotate([0, 1], Math.PI / 2), [1, 0]);
  });

  it('places a footprint at a position and rotation', () => {
    const placed = transform(rectangle(2, 1), [10, 5], Math.PI / 2);
    close(placed[0]!, [10 - 0.5, 5 + 1]);
  });

  it('normalises angles to (-π, π]', () => {
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-2 * Math.PI)).toBe(0);
    expect(angleDiff(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(0.2);
  });

  it('tests points in polygons, with an edge tolerance', () => {
    const square = rectangle(2, 2);
    expect(pointInPolygon([0, 0], square)).toBe(true);
    expect(pointInPolygon([1.005, 0], square)).toBe(false);
    expect(pointInPolygon([1.005, 0], square, 0.01)).toBe(true);
  });

  it('finds the centroid of a polygon', () => {
    close(centroid(transform(rectangle(4, 2), [3, -1], 0.3)), [3, -1]);
  });

  it('detects overlap of convex polygons but not touching or separate ones', () => {
    const a = rectangle(2, 2);
    expect(convexOverlap(a, transform(a, [1.5, 0], 0))).toBe(true);
    expect(convexOverlap(a, transform(a, [2, 0], 0))).toBe(false);
    expect(convexOverlap(a, transform(a, [2.002, 0.5], 0))).toBe(false);
    // Rotated squares: bounding boxes overlap, the shapes do not.
    expect(convexOverlap(transform(a, [0, 0], Math.PI / 4), transform(a, [2.5, 2.5], 0))).toBe(
      false,
    );
    expect(convexOverlap(ellipse(1, 1), transform(rectangle(1, 1), [0.9, 0.9], 0))).toBe(false);
    expect(convexOverlap(ellipse(1, 1), transform(rectangle(1, 1), [0.8, 0.8], 0))).toBe(true);
  });
});
