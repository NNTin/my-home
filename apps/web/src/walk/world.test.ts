import { HomeModel } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import realHomeJson from '../../../../data/homes/home.json';
import { buildHome, type Vec2 } from '../builder/buildHome';
import { createContext } from '../editor/operations';
import { roomAt } from '../editor/placement';
import { registry } from '../items/registry';
import { mockHome } from '../test/fixtures';
import {
  buildWalkWorld,
  FIGURE_RADIUS,
  placeAt,
  startPose,
  supportAt,
  walk,
  yawTowards,
  type Footing,
  type FurnitureBlocker,
} from './world';

// The real home: room, door, stair and terrain positions are those of data/homes/home.json.
const home = HomeModel.parse(structuredClone(realHomeJson));
const scene = buildHome(home);
const world = buildWalkWorld(home, scene);
const plans = createContext(home, registry).plans;
const SOUTERRAIN = -2.6;
const PATIO = -1.65;

const stand = (x: number, z: number, y = SOUTERRAIN): Footing => {
  const placed = placeAt(world, [x, z], y);
  if (!placed) throw new Error(`nothing to stand on at ${x}, ${z}`);
  return placed;
};
/** Walks towards each point in turn, in small moves like a held joystick. */
const go = (from: Footing, points: Vec2[], w = world): Footing => {
  let at = from;
  for (const [x, z] of points) {
    for (let i = 0; i < 400; i++) {
      const [dx, dz] = [x - at.x, z - at.z];
      const distance = Math.hypot(dx, dz);
      if (distance < 0.02) break;
      const stride = Math.min(0.05, distance);
      const next = walk(w, at, [(dx / distance) * stride, (dz / distance) * stride]);
      if (next === at) break;
      at = next;
    }
  }
  return at;
};
const roomOf = (at: Footing) =>
  at.levelId === undefined ? undefined : roomAt(plans.get(at.levelId)!, [at.x, at.z])?.id;

describe('walking through the souterrain apartment', () => {
  it('stands on the floor of the level it is put on', () => {
    expect(stand(10.78, -6)).toEqual({ x: 10.78, z: -6, y: SOUTERRAIN, levelId: 'souterrain' });
    expect(roomOf(stand(10.78, -6))).toBe('souterrain-corridor');
  });

  it('walks from the corridor through the door into the bed room', () => {
    const end = go(stand(10.78, -6), [[10.78, -3.5]]);
    expect(end.z).toBeCloseTo(-3.5, 1);
    expect(roomOf(end)).toBe('souterrain-bed-room');
  });

  it('is stopped by the wall beside the door', () => {
    const end = go(stand(9.5, -6), [[9.5, -3.5]]);
    // Wall centre line at z -5.4, 0.12 thick.
    expect(end.z).toBeCloseTo(-5.4 - 0.06 - FIGURE_RADIUS, 2);
    expect(roomOf(end)).toBe('souterrain-corridor');
  });

  it('slides along a wall instead of sticking to it', () => {
    const end = go(stand(9.5, -6), [[10.8, -4.5]]);
    expect(end.x).toBeGreaterThan(10.3);
    expect(roomOf(end)).toBe('souterrain-bed-room');
  });

  it('fits through every door of the corridor', () => {
    const through: [string, Vec2, Vec2][] = [
      ['souterrain-stair-hall', [4.5, -6], [2.5, -6]],
      ['souterrain-work-room', [4.875, -6], [4.875, -8]],
      ['souterrain-bath-room', [7.875, -6], [7.875, -8]],
      ['souterrain-living-room', [4.775, -6], [4.775, -4]],
      ['souterrain-boiler-room', [7.325, -6], [7.325, -4]],
      ['souterrain-bed-room', [10.775, -6], [10.775, -4]],
    ];
    for (const [room, from, to] of through) {
      expect(roomOf(go(stand(...from), [to])), room).toBe(room);
    }
  });

  it('crosses the open boundary between the kitchen and the corridor freely', () => {
    const kitchen = go(stand(11, -6), [[11, -8.5]]);
    expect(kitchen.z).toBeCloseTo(-8.5, 1);
    expect(roomOf(kitchen)).toBe('souterrain-kitchen');
    expect(roomOf(go(kitchen, [[10, -6]]))).toBe('souterrain-corridor');
  });

  it('cannot leave through an exterior wall or a window', () => {
    const north = go(stand(11, -8), [[11, -13]]);
    expect(north.z).toBeGreaterThan(-10.59);
    expect(north.levelId).toBe('souterrain');
  });

  it('is blocked by furniture on its level only', () => {
    const table: FurnitureBlocker = {
      levelId: 'souterrain',
      polygon: [
        [7.5, -6.6],
        [8.5, -6.6],
        [8.5, -5.4],
        [7.5, -5.4],
      ],
      height: 0.75,
    };
    const furnished = buildWalkWorld(home, scene, [table]);
    const blocked = go(stand(10, -6), [[5, -6]], furnished);
    expect(blocked.x).toBeCloseTo(8.5 + FIGURE_RADIUS, 2);
    expect(go(stand(10, -6), [[5, -6]]).x).toBeCloseTo(5, 1);

    const upstairs = buildWalkWorld(home, scene, [{ ...table, levelId: 'ground-floor' }]);
    expect(go(stand(10, -6), [[5, -6]], upstairs).x).toBeCloseTo(5, 1);
  });
});

describe('the stair between the souterrain and the ground floor', () => {
  // The walking line going up: north along the hall's east side, west, then south.
  const path: Vec2[] = [
    [2.85, -8.43],
    [2.85, -10.05],
    [0.9, -10.05],
    [0.9, -8.43],
  ];

  it('climbs to the ground floor counter-clockwise and comes back down', () => {
    let at = stand(2.85, -7.8);
    // From the foot of the stair (still on the floor) over the two landings to the last tread.
    const heights: number[] = [];
    for (const corner of path) {
      at = go(at, [corner]);
      heights.push(at.y);
    }
    // Every leg is higher than the last, and the turns are left turns (counter-clockwise).
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
    expect(new Set(heights).size).toBe(heights.length);
    expect(heights[0]).toBe(SOUTERRAIN);
    expect(heights.at(-1)).toBeCloseTo(-scene.stairs[0]!.rise);
    const up = go(at, [[0.9, -7.6]]);
    expect(up).toMatchObject({ y: 0, levelId: 'ground-floor' });
    expect(roomOf(up)).toBe('ground-floor-interior');

    const down = go(up, [...path].reverse().concat([[2.85, -7.8]]));
    expect(down).toMatchObject({ y: SOUTERRAIN, levelId: 'souterrain' });
    expect(roomOf(down)).toBe('souterrain-stair-hall');
  });

  it('switches level half-way up', () => {
    const low = go(stand(2.85, -7.8), [[2.85, -9.2]]);
    expect(low.y).toBeGreaterThan(SOUTERRAIN);
    expect(low.levelId).toBe('souterrain');
    const high = go(low, [path[1]!, path[2]!, [0.9, -8.8]]);
    expect(high.y).toBeGreaterThan(-1.3);
    expect(high.y).toBeLessThan(0);
    expect(high.levelId).toBe('ground-floor');
  });

  it('does not step off the side of a flight or into the stairwell from above', () => {
    const onFlight = go(stand(2.85, -7.8), [path[0]!, path[1]!, path[2]!, [0.9, -9]]);
    expect(onFlight.y).toBeGreaterThan(-1.2);
    const sideways = go(onFlight, [[2.2, -9]]);
    expect(sideways.x).toBeLessThan(1.45);
    expect(sideways.y).toBe(onFlight.y);

    // On the ground floor, walking at the opening in the floor from the east.
    const upstairs = go(stand(5, -9.5, 0), [[1.5, -9.5]]);
    expect(upstairs.y).toBe(0);
    expect(upstairs.x).toBeGreaterThan(3.35);
  });

  it('has nothing to stand on in the stairwell at ground-floor height', () => {
    expect(supportAt(world, [1.9, -9.5], 0)).toBeUndefined();
    expect(supportAt(world, [5, -9.5], 0)?.y).toBe(0);
  });
});

describe('walking outside', () => {
  it('leaves by the patio door, up the steps onto the patio', () => {
    const steps = [stand(12.5, -6)];
    for (const x of [14, 14.75, 15.05, 16.5]) steps.push(go(steps.at(-1)!, [[x, -6]]));
    expect(steps.map((s) => s.y)).toEqual([SOUTERRAIN, SOUTERRAIN, -2.28, -1.96, PATIO]);
    expect(steps.map((s) => s.levelId)).toEqual([
      'souterrain',
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(steps.at(-1)!.x).toBeCloseTo(16.5, 1);
    // And back in.
    expect(go(steps.at(-1)!, [[12.5, -6]])).toMatchObject({ y: SOUTERRAIN, levelId: 'souterrain' });
  });

  it('cannot climb out of the sunken entry at its sides', () => {
    const pit = go(stand(12.5, -6), [[14, -6]]);
    expect(go(pit, [[14, -8.5]]).z).toBeGreaterThan(-7.2);
    expect(go(pit, [[14, -3.5]]).z).toBeLessThan(-4.8);
  });

  it('passes the gate to the lane and is stopped by the fence beside it', () => {
    const gate = go(stand(18.5, -6.65, PATIO), [[20.3, -6.65]]);
    expect(gate.x).toBeCloseTo(20.3, 1);
    expect(gate.y).toBeGreaterThan(PATIO);
    const fence = go(stand(18.5, -4, PATIO), [[20.3, -4]]);
    expect(fence.x).toBeLessThan(19.3 - FIGURE_RADIUS + 0.01);
  });

  it('does not cross the steep bank between the patio and the upper garden', () => {
    const below = go(stand(16, -1.5, PATIO), [[16, 2]]);
    expect(below.z).toBeLessThan(-0.5);
    expect(below.y).toBe(PATIO);
    const above = go(stand(16, 2, 0), [[16, -2]]);
    expect(above.z).toBeGreaterThan(0.5);
  });

  it('walks down the gently sloping lane', () => {
    const top = stand(21, 0, 0);
    const bottom = go(top, [[21, -12]]);
    expect(bottom.z).toBeCloseTo(-12, 1);
    expect(bottom.y).toBeLessThan(top.y - 0.5);
  });
});

describe('start pose', () => {
  it('starts just inside the patio door of the real home, facing into the corridor', () => {
    const start = startPose(home, world)!;
    expect(start).toMatchObject({ y: SOUTERRAIN, levelId: 'souterrain' });
    expect(start.z).toBeCloseTo(-6, 1);
    expect(start.x).toBeGreaterThan(12);
    expect(start.x).toBeLessThan(13);
    expect(roomOf(start)).toBe('souterrain-corridor');
    // Facing west, along -x.
    expect(start.yaw).toBeCloseTo(Math.PI / 2);
  });

  it('starts at the foot of the entrance stair when no entrance is a door', () => {
    const stairsOnly = structuredClone(home);
    for (const apartment of stairsOnly.apartments) {
      apartment.entrances = apartment.entrances?.filter((e) => e.viaId.startsWith('stair-'));
    }
    const start = startPose(stairsOnly, world)!;
    expect(roomOf(start)).toBe('souterrain-stair-hall');
    expect(start.x).toBeCloseTo(2.85);
    expect(start.z).toBeCloseTo(-7.93);
    // Looking north, up the first flight.
    expect(start.yaw).toBeCloseTo(0);
  });

  it('starts in a room of the lowest level in a home without entrances', () => {
    const mockScene = buildHome(mockHome);
    const mockWorld = buildWalkWorld(mockHome, mockScene);
    const start = startPose({ ...mockHome, apartments: [] }, mockWorld)!;
    expect(start.levelId).toBe('souterrain');
    expect(walk(mockWorld, start, [0.3, 0])).not.toBe(start);
  });

  it('turns a plan direction into a yaw', () => {
    expect(yawTowards([0, -1])).toBeCloseTo(0);
    expect(yawTowards([-1, 0])).toBeCloseTo(Math.PI / 2);
    expect(yawTowards([1, 0])).toBeCloseTo(-Math.PI / 2);
    expect(Math.abs(yawTowards([0, 1]))).toBeCloseTo(Math.PI);
  });
});
