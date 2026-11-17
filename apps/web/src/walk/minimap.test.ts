import { HomeModel } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import realHomeJson from '../../../../data/homes/home.json';
import { buildHome } from '../builder/buildHome';
import { createContext } from '../editor/operations';
import { registry } from '../items/registry';
import { mockHome } from '../test/fixtures';
import {
  fromMap,
  groundLevelId,
  MAP_SIZE,
  mapRotation,
  minimapLevels,
  screenToMap,
  toMap,
  type MapView,
} from './minimap';
import { buildWalkWorld, placeAt, standAt } from './world';

const mockScene = buildHome(mockHome);
const mockLevels = minimapLevels(
  mockScene,
  createContext(mockHome, registry).plans,
  groundLevelId(mockScene, 0),
);

describe('minimap plan data', () => {
  it('has every level with its rooms, walls, doors and windows', () => {
    expect([...mockLevels.keys()]).toEqual(['souterrain', 'ground-floor', 'first-floor']);
    const souterrain = mockLevels.get('souterrain')!;
    expect(souterrain.rooms.map((r) => r.name)).toEqual([
      'Hallway',
      'Living room',
      'Bedroom',
      'Kitchen',
      'Bathroom',
    ]);
    // The room name sits inside its room.
    const hallway = souterrain.rooms[0]!;
    expect(hallway.label[0]).toBeGreaterThan(-0.5);
    expect(hallway.label[0]).toBeLessThan(1.5);
    expect(souterrain.walls.length).toBeGreaterThan(4);
    expect(souterrain.doors.length).toBeGreaterThan(0);
    expect(souterrain.windows.length).toBeGreaterThan(0);
    expect(souterrain.bounds.min[0]).toBeLessThanOrEqual(-5);
    expect(souterrain.bounds.max[0]).toBeGreaterThanOrEqual(5);
  });

  it('shows the stair on both levels it joins, and fences only on the ground level', () => {
    const home = HomeModel.parse(structuredClone(realHomeJson));
    const scene = buildHome(home);
    const ground = groundLevelId(scene, home.terrain.groundElevation.value);
    const levels = minimapLevels(scene, createContext(home, registry).plans, ground);
    const [stair] = scene.stairs;
    for (const id of [stair!.levelId, stair!.toLevelId]) {
      expect(levels.get(id)!.stairs.find((s) => s.id === stair!.id)).toMatchObject({
        fromLevelId: stair!.levelId,
        toLevelId: stair!.toLevelId,
        steps: expect.arrayContaining([expect.any(Array)]) as unknown,
      });
    }
    const withFences = [...levels.values()].filter((l) => l.fences.length + l.gates.length > 0);
    expect(withFences.map((l) => l.levelId)).toEqual(scene.fences.length > 0 ? [ground] : []);
  });
});

describe('minimap maths', () => {
  it('turns the map so the figure looks up, or so true north is up', () => {
    // Facing west (yaw +90°): turned 90° clockwise, west is up.
    expect(mapRotation('heading', Math.PI / 2, 30)).toBeCloseTo(90);
    expect(mapRotation('north', Math.PI / 2, 30)).toBe(-30);
    const view: MapView = { center: [0, 0], scale: 10, rotation: 90 };
    const [u, v] = toMap(view, [-1, 0]);
    expect(u).toBeCloseTo(0);
    expect(v).toBeCloseTo(-10);
    // True north 30° clockwise of -z, turned north-up: it points straight up.
    const north: MapView = { center: [0, 0], scale: 10, rotation: -30 };
    const rad = (30 * Math.PI) / 180;
    const [nu, nv] = toMap(north, [Math.sin(rad), -Math.cos(rad)]);
    expect(nu).toBeCloseTo(0);
    expect(nv).toBeCloseTo(-10);
  });

  it('finds the plan point of a tap', () => {
    const view: MapView = { center: [3, -2], scale: 4, rotation: 37 };
    const back = fromMap(view, toMap(view, [5.5, 1.25]));
    expect(back[0]).toBeCloseTo(5.5);
    expect(back[1]).toBeCloseTo(1.25);
    // A 300 x 200 box: the map is the centred 200 x 200 square.
    const box = { left: 10, top: 20, width: 300, height: 200 };
    expect(screenToMap(box, 160, 120)).toEqual([0, 0]);
    expect(screenToMap(box, 260, 220)).toEqual([MAP_SIZE / 2, MAP_SIZE / 2]);
    expect(screenToMap({ ...box, width: 0 }, 1, 1)).toBeUndefined();
  });
});

describe('standAt (a tap on the map)', () => {
  const world = buildWalkWorld(mockHome, mockScene);
  it('sets the figure down on a free spot of the floor, and nowhere else', () => {
    expect(standAt(world, [0.5, 0], -1.2)).toMatchObject({
      x: 0.5,
      z: 0,
      y: -1.2,
      levelId: 'souterrain',
    });
    // Inside the wall between the hallway and the living room (x = -0.5).
    const inWall = standAt(world, [-0.5, -2], -1.2);
    expect(inWall === undefined || Math.abs(inWall.x + 0.5) >= 0.2).toBe(true);
    // Far outside the building there is nothing at the souterrain's height.
    expect(placeAt(world, [40, 40], -1.2)).toBeUndefined();
    expect(standAt(world, [40, 40], -1.2)).toBeUndefined();
  });
});
