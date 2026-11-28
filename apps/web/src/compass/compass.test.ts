import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../geom/types';
import {
  azimuthOf,
  compassMarkers,
  compassRotation,
  directionOf,
  normalizeDegrees,
  northUpPosition,
} from './compass';

const close = (actual: number[], expected: number[]) =>
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!));

describe('normalizeDegrees', () => {
  it('maps angles into (-180, 180]', () => {
    expect(normalizeDegrees(0)).toBe(0);
    expect(normalizeDegrees(190)).toBe(-170);
    expect(normalizeDegrees(-190)).toBe(170);
    expect(normalizeDegrees(180)).toBe(180);
    expect(normalizeDegrees(720 + 45)).toBe(45);
  });
});

describe('directionOf', () => {
  it('points bearing 0 at -z and turns clockwise seen from above', () => {
    close(directionOf(0), [0, -1]);
    close(directionOf(90), [1, 0]); // east is +x
    close(directionOf(180), [0, 1]);
    close(directionOf(270), [-1, 0]);
  });
});

describe('azimuthOf', () => {
  it('matches OrbitControls: 0 south of the target, +90° east of it', () => {
    expect(azimuthOf([0, 5, 10], [0, 0, 0])).toBeCloseTo(0);
    expect(azimuthOf([10, 5, 0], [0, 0, 0])).toBeCloseTo(Math.PI / 2);
    expect(azimuthOf([1, 2, 3], [1, 0, -7])).toBeCloseTo(0);
  });
});

describe('compassRotation', () => {
  it('keeps N up when looking north with north at -z', () => {
    expect(compassRotation(0, 0)).toBeCloseTo(0);
  });

  it('turns N to the right when the camera stands east of the target', () => {
    // Camera at +x looks towards -x (west): north is on its right.
    expect(compassRotation(0, Math.PI / 2)).toBeCloseTo(90);
    // Camera at -z looks south: north is behind, at the bottom of the screen.
    expect(Math.abs(compassRotation(0, Math.PI))).toBeCloseTo(180);
  });

  it('adds the building bearing', () => {
    expect(compassRotation(30, 0)).toBeCloseTo(30);
    expect(compassRotation(-30, Math.PI / 2)).toBeCloseTo(60);
    expect(compassRotation(350, (20 * Math.PI) / 180)).toBeCloseTo(10);
  });

  it('agrees with projecting true north onto the screen', () => {
    for (const bearing of [0, 37, -120]) {
      for (const camera of [
        [12, 9, 15],
        [-8, 4, 3],
        [0.5, 20, -11],
      ] as Vec3[]) {
        const target: Vec3 = [1, 0, -2];
        const fx = target[0] - camera[0];
        const fz = target[2] - camera[2];
        const [nx, nz] = directionOf(bearing);
        // Screen up is the camera's horizontal forward, screen right is (-fz, fx).
        const expected = (Math.atan2(nx * -fz + nz * fx, nx * fx + nz * fz) * 180) / Math.PI;
        expect(compassRotation(bearing, azimuthOf(camera, target))).toBeCloseTo(expected);
      }
    }
  });
});

describe('northUpPosition', () => {
  it('turns the camera about the target so north points up the screen', () => {
    const target: Vec3 = [1, 2, 3];
    for (const bearing of [0, 45, 200]) {
      const camera = northUpPosition([10, 8, -4], target, bearing);
      expect(camera[1]).toBe(8);
      expect(Math.hypot(camera[0] - 1, camera[2] - 3)).toBeCloseTo(Math.hypot(9, -7));
      expect(compassRotation(bearing, azimuthOf(camera, target))).toBeCloseTo(0);
    }
  });
});

describe('compassMarkers', () => {
  const footprint: [number, number][] = [
    [-5, -4],
    [5, -4],
    [5, 4],
    [-5, 4],
  ];

  it('places N/E/S/W around the building on the ground', () => {
    const markers = compassMarkers(footprint, 0, 0, 2);
    const r = Math.hypot(10, 8) / 2 + 2;
    expect(markers.map((m) => m.label)).toEqual(['N', 'E', 'S', 'W']);
    close(markers[0]!.position, [0, 0, -r]);
    close(markers[1]!.position, [r, 0, 0]);
    close(markers[2]!.position, [0, 0, r]);
    close(markers[3]!.position, [-r, 0, 0]);
  });

  it('rotates with the north bearing', () => {
    const [north] = compassMarkers(footprint, 0.5, 90);
    expect(north!.position[0]).toBeGreaterThan(0);
    expect(north!.position[1]).toBe(0.5);
    expect(north!.position[2]).toBeCloseTo(0);
  });
});
