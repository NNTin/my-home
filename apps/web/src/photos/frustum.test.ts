import { describe, expect, it } from 'vitest';
import {
  cameraBasis,
  frustumCorners,
  fovHOf,
  headingDegrees,
  matchingVerticalFov,
  verticalFov,
} from './frustum';

const round = (v: number[]) => v.map((n) => Math.round(n * 1000) / 1000 + 0);
const pose = (yaw = 0, pitch = 0) => ({ position: { x: 1, y: 1.6, z: 2 }, yaw, pitch });
const deg = (d: number) => (d * Math.PI) / 180;

describe('camera basis', () => {
  it('looks along -z at yaw 0 with x to the right and y up', () => {
    const { forward, right, up } = cameraBasis(pose());
    expect(round(forward)).toEqual([0, 0, -1]);
    expect(round(right)).toEqual([1, 0, 0]);
    expect(round(up)).toEqual([0, 1, 0]);
  });

  it('turns counter-clockwise with yaw and tilts up with pitch', () => {
    const west = cameraBasis(pose(Math.PI / 2));
    expect(round(west.forward)).toEqual([-1, 0, 0]);
    expect(round(west.right)).toEqual([0, 0, -1]);
    const up = cameraBasis(pose(0, deg(30)));
    expect(round(up.forward)).toEqual([0, 0.5, -0.866]);
    expect(round(up.up)).toEqual([0, 0.866, 0.5]);
    expect(round(up.right)).toEqual([1, 0, 0]);
  });
});

describe('view cone', () => {
  it('spans the field of view at the given distance', () => {
    // 90° wide, 2:1: at 1 m the image plane is 2 m wide and 1 m high.
    const corners = frustumCorners(pose(), deg(90), 2, 1).map(round);
    expect(corners).toEqual([
      [0, 2.1, 1],
      [2, 2.1, 1],
      [2, 1.1, 1],
      [0, 1.1, 1],
    ]);
  });

  it('follows the heading and the pitch', () => {
    const west = frustumCorners(pose(Math.PI / 2), deg(90), 2, 1).map(round);
    // Looking along -x: left of the camera is +z.
    expect(west[0]).toEqual([0, 2.1, 3]);
    expect(west[1]).toEqual([0, 2.1, 1]);
    const down = frustumCorners(pose(0, -Math.PI / 2), deg(90), 1, 1).map(round);
    // Straight down: the image plane lies 1 m below the camera, its top edge towards -z.
    expect(down.every((c) => c[1] === 0.6)).toBe(true);
    expect(down[0]).toEqual([0, 0.6, 1]);
    expect(down[2]).toEqual([2, 0.6, 3]);
  });
});

describe('field of view', () => {
  it('converts a horizontal field of view to a vertical one', () => {
    expect(verticalFov(deg(90), 1)).toBeCloseTo(deg(90));
    expect(verticalFov(deg(90), 2)).toBeCloseTo(2 * Math.atan(0.5));
  });

  it('matches the 3D camera to a photo laid over the view', () => {
    const fovH = deg(60);
    // A landscape photo over a wider view fills its height: the photo's own vertical angle.
    expect(matchingVerticalFov(fovH, 4 / 3, 16 / 9)).toBeCloseTo(verticalFov(fovH, 4 / 3));
    // Over a narrower view (a phone held upright) it fills the width instead.
    expect(matchingVerticalFov(fovH, 4 / 3, 9 / 16)).toBeCloseTo(verticalFov(fovH, 9 / 16));
    expect(matchingVerticalFov(fovH, 4 / 3, 4 / 3)).toBeCloseTo(verticalFov(fovH, 4 / 3));
  });

  it('assumes a typical phone camera when the photo has no field of view', () => {
    const image = { contentType: 'image/webp', width: 1920, height: 2560, byteSize: 1 };
    // 26 mm with the 36 mm side on the long edge: 55° across an upright 4:3 picture.
    expect((fovHOf({ pose: pose(), image }) * 180) / Math.PI).toBeCloseTo(54.9, 0);
    const across = { ...image, width: 2560, height: 1920 };
    expect((fovHOf({ pose: pose(), image: across }) * 180) / Math.PI).toBeCloseTo(69.4, 0);
    expect(fovHOf({ pose: { ...pose(), fovH: 1 }, image })).toBe(1);
  });

  it('shows a yaw as a compass-style heading', () => {
    expect(headingDegrees(0)).toBe(0);
    expect(headingDegrees(-Math.PI / 2)).toBe(90);
    expect(headingDegrees(Math.PI / 2)).toBe(270);
    expect(headingDegrees(Math.PI)).toBe(180);
    expect(headingDegrees(-0.001)).toBe(0);
  });
});
