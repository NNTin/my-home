import { poseDirection } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import { buildHome } from '../builder/buildHome';
import { mockHome } from '../test/fixtures';
import {
  advance,
  combineInputs,
  facing,
  inputFromKeys,
  inputFromPad,
  look,
  MAX_PITCH,
  NO_INPUT,
  poseOf,
  rightOf,
  stride,
  TURN_SPEED,
  WALK_SPEED,
  yawFromCompass,
  type Figure,
} from './figure';
import { horizontalFov } from '../photos/fieldOfView';
import { buildWalkWorld, EYE_HEIGHT, FIGURE_RADIUS } from './world';

// Mock home, souterrain (floor at -1.2): the hallway is x -0.5…1.5, z -4…4.
const world = buildWalkWorld(mockHome, buildHome(mockHome));
const figure = (overrides: Partial<Figure> = {}): Figure => ({
  x: 0.5,
  z: 0,
  y: -1.2,
  levelId: 'souterrain',
  yaw: 0,
  pitch: 0,
  ...overrides,
});
const round = (values: number[]) => values.map((v) => Math.round(v * 1000) / 1000 + 0);

describe('heading and pitch', () => {
  it('faces -z at yaw 0 and turns counter-clockwise', () => {
    expect(round(facing(0))).toEqual([0, -1]);
    expect(round(facing(Math.PI / 2))).toEqual([-1, 0]);
    expect(round(rightOf(0))).toEqual([1, 0]);
    expect(round(rightOf(Math.PI / 2))).toEqual([0, -1]);
  });

  it('agrees with the photo pose direction', () => {
    for (const yaw of [0, 0.7, 2, -2.5]) {
      const d = poseDirection({ yaw, pitch: 0 });
      expect(round(facing(yaw))).toEqual(round([d.x, d.z]));
    }
  });

  it('looks around: yaw wraps, pitch stops short of straight up and down', () => {
    expect(look(figure({ yaw: 3 }), 0.5, 0).yaw).toBeCloseTo(3.5 - 2 * Math.PI);
    expect(look(figure(), 0, 0.3).pitch).toBeCloseTo(0.3);
    expect(look(figure(), 0, 9).pitch).toBe(MAX_PITCH);
    expect(look(figure(), 0, -9).pitch).toBe(-MAX_PITCH);
  });

  it('turns a compass bearing into a yaw using the north bearing of the plan', () => {
    // North is -z: looking north is yaw 0, east (clockwise) is yaw -90°.
    expect(yawFromCompass(0, 0)).toBeCloseTo(0);
    expect(yawFromCompass(90, 0)).toBeCloseTo(-Math.PI / 2);
    expect(yawFromCompass(270, 0)).toBeCloseTo(Math.PI / 2);
    // True north is 20° clockwise of -z: looking north means looking 20° clockwise of -z.
    expect(yawFromCompass(0, 20)).toBeCloseTo((-20 * Math.PI) / 180);
    expect(round(facing(yawFromCompass(70, 20)))).toEqual([1, 0]);
  });

  it('gives the camera pose at eye height', () => {
    const pose = poseOf(figure({ x: 1, z: 2, yaw: 0.4, pitch: -0.2 }), 1.2);
    expect(pose).toEqual({
      position: { x: 1, y: -1.2 + EYE_HEIGHT, z: 2 },
      yaw: 0.4,
      pitch: -0.2,
      fovH: 1.2,
    });
    expect(poseOf(figure())).not.toHaveProperty('fovH');
  });

  it('derives the horizontal field of view from the focal length and the picture size', () => {
    // 26 mm on a 4:3 phone picture: about 69° across, 55° upright.
    expect((horizontalFov(4000, 3000) * 180) / Math.PI).toBeCloseTo(69.4, 0);
    expect((horizontalFov(3000, 4000) * 180) / Math.PI).toBeCloseTo(54.9, 0);
    expect(horizontalFov(4000, 3000, 13)).toBeGreaterThan(horizontalFov(4000, 3000, 26));
  });

  it('puts the 36 mm side on the long edge, so a 4:3 portrait is wider than 3:2 film (#70)', () => {
    // The owner's phone, 23 mm: calibrated from vanishing points at 1.318 across and
    // 1.05 to 1.14 upright. The old code stored 0.962 upright (36 x 24 mm held upright).
    expect(horizontalFov(2560, 1920, 23)).toBeCloseTo(1.3281, 4);
    expect(horizontalFov(1920, 2560, 23)).toBeCloseTo(2 * Math.atan(13.5 / 23), 6);
    expect(horizontalFov(1920, 2560, 23)).toBeCloseTo(1.0614, 3);
    // 3:2 upright is the film frame itself, 16:9 upright the 4:3 sensor cut at the top and bottom.
    expect(horizontalFov(2000, 3000, 23)).toBeCloseTo(2 * Math.atan(12 / 23), 6);
    expect(horizontalFov(1080, 1920, 23)).toBeCloseTo(2 * Math.atan((18 * 9) / 16 / 23), 6);
    expect(horizontalFov(1920, 1080, 23)).toBeCloseTo(horizontalFov(2560, 1920, 23), 6);
  });

  it('gives a 4:3 portrait about 1.06 rad for a camera calibrated at 1.318 across', () => {
    const focal = 18 / Math.tan(1.318 / 2);
    expect(horizontalFov(2560, 1920, focal)).toBeCloseTo(1.318, 6);
    // 2 · atan(0.75 · tan(1.318 / 2)): the same camera held upright.
    expect(horizontalFov(1920, 2560, focal)).toBeCloseTo(1.0525, 3);
  });

  it('narrows the field of view by the zoom', () => {
    expect(Math.tan(horizontalFov(4000, 3000, 26, 2) / 2)).toBeCloseTo(
      Math.tan(horizontalFov(4000, 3000, 26) / 2) / 2,
    );
  });
});

describe('movement', () => {
  it('walks forward where it faces, at walking speed', () => {
    const north = advance(world, figure(), { ...NO_INPUT, forward: 1 }, 0.5);
    expect(north.z).toBeCloseTo(-WALK_SPEED * 0.5);
    expect(north.x).toBeCloseTo(0.5);
    const south = advance(world, figure({ yaw: Math.PI }), { ...NO_INPUT, forward: 1 }, 0.5);
    expect(south.z).toBeCloseTo(WALK_SPEED * 0.5);
    const back = advance(world, figure(), { ...NO_INPUT, forward: -1 }, 0.5);
    expect(back.z).toBeCloseTo(WALK_SPEED * 0.5);
  });

  it('sidesteps, and is no faster diagonally', () => {
    const right = advance(world, figure(), { ...NO_INPUT, strafe: 1 }, 0.2);
    expect(right.x).toBeCloseTo(0.5 + WALK_SPEED * 0.2);
    const diagonal = advance(world, figure(), { forward: 1, strafe: 1, turn: 0 }, 0.2);
    expect(Math.hypot(diagonal.x - 0.5, diagonal.z)).toBeCloseTo(WALK_SPEED * 0.2);
  });

  it('turns left with positive turn input', () => {
    expect(advance(world, figure(), { ...NO_INPUT, turn: 1 }, 0.5).yaw).toBeCloseTo(
      TURN_SPEED * 0.5,
    );
    expect(advance(world, figure(), { ...NO_INPUT, turn: -1 }, 0.5).yaw).toBeCloseTo(
      -TURN_SPEED * 0.5,
    );
  });

  it('is stopped by a wall and keeps its place', () => {
    // East wall of the hallway at x 1.5 (0.12 thick).
    let at = figure({ yaw: -Math.PI / 2 });
    for (let i = 0; i < 100; i++) at = advance(world, at, { ...NO_INPUT, forward: 1 }, 0.05);
    expect(at.x).toBeLessThanOrEqual(1.5 - FIGURE_RADIUS);
    expect(at.x).toBeGreaterThan(1.1);
    expect(advance(world, at, { ...NO_INPUT, forward: 1 }, 0.05)).toBe(at);
    expect(advance(world, at, NO_INPUT, 0.05)).toBe(at);
  });

  it('nudges by a distance relative to where it faces', () => {
    const nudged = stride(world, figure({ yaw: Math.PI / 2 }), 0.1, 0);
    expect(nudged.x).toBeCloseTo(0.4);
    expect(nudged.z).toBeCloseTo(0);
    expect(stride(world, figure(), 0, 0.1).x).toBeCloseTo(0.6);
  });
});

describe('inputs', () => {
  it('maps keys to walking, sidestepping and turning', () => {
    expect(inputFromKeys(new Set(['w']))).toEqual({ forward: 1, strafe: 0, turn: 0 });
    expect(inputFromKeys(new Set(['arrowdown', 'd']))).toEqual({ forward: -1, strafe: 1, turn: 0 });
    expect(inputFromKeys(new Set(['arrowleft']))).toEqual({ forward: 0, strafe: 0, turn: 1 });
    expect(inputFromKeys(new Set(['e', 'a']))).toEqual({ forward: 0, strafe: -1, turn: -1 });
    expect(inputFromKeys(new Set(['w', 's']))).toEqual(NO_INPUT);
  });

  it('maps the pad: up walks forward, left turns left', () => {
    expect(inputFromPad(0, -1)).toEqual({ forward: 1, strafe: 0, turn: 0 });
    expect(inputFromPad(-1, 0)).toMatchObject({ forward: 0, turn: 1 });
    expect(inputFromPad(0.5, 0.5)).toMatchObject({ forward: -0.5, turn: -0.5 });
    // While the compass turns the figure, left and right sidestep instead of turning.
    expect(inputFromPad(0.5, -1, true)).toEqual({ forward: 1, strafe: 0.5, turn: 0 });
  });

  it('combines pad and keys within limits', () => {
    expect(combineInputs(inputFromPad(0, -1), inputFromKeys(new Set(['w', 'q'])))).toEqual({
      forward: 1,
      strafe: 0,
      turn: 1,
    });
  });
});
