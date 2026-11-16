import { HomeModel } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import realHomeJson from '../../../../data/homes/home.json';
import {
  buildHome,
  buildOutbuilding,
  gableOf,
  openingParts,
  resolveSlope,
  roofUnderside,
  slopeY,
  SURFACE_OFFSET,
  type Vec2,
} from './buildHome';
import { defaultVisibility, visibleScene } from './visibility';

const home = () => HomeModel.parse(structuredClone(realHomeJson));
const square: Vec2[] = [
  [0, 0],
  [4, 0],
  [4, 2],
  [0, 2],
];
const dim = (value: number) => ({ value, source: 'mock' as const });

describe('slopes', () => {
  it('fall linearly across the bounding box towards the given side, clamped beyond it', () => {
    const east = resolveSlope(square, 1, { towards: '+x', lowElevation: dim(-1) })!;
    expect(east).toEqual({ axis: 'x', from: 0, to: 4, high: 1, low: -1 });
    expect([0, 1, 2, 4, 9].map((x) => slopeY(east, [x, 1]))).toEqual([1, 0.5, 0, -1, -1]);
    const north = resolveSlope(square, 0, { towards: '-z', lowElevation: dim(-2) }, 0.5)!;
    expect(north).toEqual({ axis: 'z', from: 2, to: 0, high: 0.5, low: -1.5 });
    expect(slopeY(north, [3, 1])).toBe(-0.5);
    expect(resolveSlope(square, 0, undefined)).toBeUndefined();
  });

  it('turns sloped terrain patches and outdoor areas into sloped descriptors', () => {
    const scene = buildHome(home());
    const slope = scene.terrain.find((t) => t.id === 'terrain-entrance-slope')!;
    expect(slope).toMatchObject({ top: -0.05, slope: { axis: 'z', from: 2.5, to: -1.5 } });
    expect(slope.slope).toMatchObject({ high: -0.05, low: -1.65 });
    const path = scene.outdoorAreas.find((a) => a.id === 'entrance-souterrain')!;
    expect(path.slope!.low).toBeCloseTo(-1.65 + SURFACE_OFFSET);
    // Flat patches stay flat.
    expect(scene.terrain.find((t) => t.id === 'terrain-lower')!.slope).toBeUndefined();
  });
});

describe('outbuildings', () => {
  const [garage, passage] = home().outbuildings!;

  it('draws a wall on every edge, split around its openings, and a flat roof', () => {
    const b = buildOutbuilding(garage!);
    expect(b.walls.filter((w) => w.id.startsWith('garage:0:')).map((w) => w.id)).toEqual([
      'garage:0:0:full',
      'garage:0:1:above',
      'garage:0:2:full',
    ]);
    expect(new Set(b.walls.map((w) => w.id.split(':')[1]))).toEqual(new Set(['0', '1', '2', '3']));
    const door = b.openings[0]!;
    expect(door.type).toBe('garage-door');
    // Edge 0 runs east along z = -5.02 from x = -4.73; the door is 0.45 m in and 2.5 m wide.
    expect(door.center[0]).toBeCloseTo(-4.73 + 0.45 + 1.25);
    expect(door.center[1]).toBeCloseTo(-0.2 + 1.05);
    expect(door.center[2]).toBeCloseTo(-5.02);
    expect(b.roof.top).toBeCloseTo(2.27 + SURFACE_OFFSET);
    expect(b.roof.bottom).toBeCloseTo(2.07);
  });

  it('runs walls half a thickness past the corners so they close', () => {
    const b = buildOutbuilding(garage!);
    const lengths = b.walls
      .filter((w) => w.id.endsWith(':full') && w.id.split(':')[1] === '1')
      .map((w) => w.size[0]);
    expect(lengths).toEqual([expect.closeTo(5.81 + 0.24, 6)]);
  });

  it('leaves open edges without walls', () => {
    const b = buildOutbuilding(passage!);
    expect(new Set(b.walls.map((w) => w.id.split(':')[1]))).toEqual(new Set(['0']));
    expect(b.openings.map((o) => o.id)).toEqual(['passage-arch']);
  });

  it('are part of the scene and its bounds', () => {
    const scene = buildHome(home());
    expect(scene.outbuildings.map((b) => b.id)).toEqual(['garage', 'entrance-passage']);
    expect(scene.bounds.min[0]).toBeLessThanOrEqual(-4.85);
  });
});

describe('roof windows', () => {
  it('lie on their roof plane, just above its top surface', () => {
    const model = home();
    const scene = buildHome(model);
    const gable = gableOf(model, scene.levels.at(-1))!;
    const [w] = scene.roofWindows;
    expect(w).toMatchObject({ id: 'roof-window-south', levelId: 'first-floor', rotationY: 0 });
    expect(w!.tilt).toBeCloseTo((29 * Math.PI) / 180);
    expect(w!.size).toEqual([0.8, expect.any(Number), 1]);
    // Along the ridge from the footprint's west end; on the south (max z) plane.
    expect(w!.center[0]).toBeCloseTo(0.18 + 7.1 + 0.4);
    expect(w!.center[2]).toBeGreaterThan(gable.ridge);
    const top = roofUnderside(gable, w!.center[2]) + gable.thickness * Math.hypot(1, gable.slope);
    expect((w!.center[1] - top) * Math.cos(w!.tilt)).toBeCloseTo(w!.size[1] / 2);
  });

  it('turn to face the other plane or a north-south ridge', () => {
    const model = home();
    const roof = model.building.roof as Extract<typeof model.building.roof, { type: 'gable' }>;
    roof.windows![0]!.side = 'min';
    expect(buildHome(model).roofWindows[0]!.rotationY).toBeCloseTo(Math.PI);
    roof.ridgeAxis = 'z';
    roof.windows![0]!.offset = dim(1);
    expect(buildHome(model).roofWindows[0]!.rotationY).toBeCloseTo(-Math.PI / 2);
  });

  it('are hidden with the roof', () => {
    const scene = buildHome(home());
    expect(visibleScene(scene, defaultVisibility(scene)).roofWindows).toHaveLength(1);
    const attic = { ...defaultVisibility(scene), maxLevelIndex: 2 };
    expect(visibleScene(scene, attic).roofWindows).toEqual([]);
    expect(visibleScene(scene, attic).outbuildings).toHaveLength(2);
  });
});

describe('openingParts for door types', () => {
  it('glazes French doors to the floor and closes garage doors with a panel', () => {
    const french = openingParts({ type: 'french-door', size: [2, 2.2, 0.36] });
    expect(french.frame).toHaveLength(3);
    expect(french.glass!.size[1]).toBeCloseTo(2.2 - 0.06);
    expect(french.panel).toBeUndefined();
    const garage = openingParts({ type: 'garage-door', size: [2.5, 2.1, 0.24] });
    expect(garage.frame).toHaveLength(3);
    expect(garage.glass).toBeUndefined();
    expect(garage.panel!.size[0]).toBeCloseTo(2.5 - 0.12);
  });
});
