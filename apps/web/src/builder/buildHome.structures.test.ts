import { HomeModel } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import realHomeJson from '../../../../data/homes/home.json';
import {
  buildHome,
  buildOutbuilding,
  gableOf,
  resolveSlope,
  roofUnderside,
  slopeY,
  SURFACE_OFFSET,
  type Vec2,
} from './buildHome';
import { wholeVisibility, visibleScene } from './visibility';

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
    const slope = scene.terrain.find((t) => t.id === 'terrain-garden-divider')!;
    expect(slope).toMatchObject({ top: -0.05, slope: { axis: 'z', from: 0.5, to: -0.5 } });
    expect(slope.slope).toMatchObject({ high: -0.05, low: -1.65 });
    const path = scene.outdoorAreas.find((a) => a.id === 'garden-divider')!;
    expect(path.slope!.low).toBeCloseTo(-1.65 + SURFACE_OFFSET);
    // Flat patches stay flat.
    expect(scene.terrain.find((t) => t.id === 'terrain-lower')!.slope).toBeUndefined();
  });
});

describe('outbuildings', () => {
  const outbuilding = (id: string) => home().outbuildings!.find((b) => b.id === id)!;
  const garage = outbuilding('garage');
  const passage = outbuilding('entrance-passage');

  it('draws a wall on every edge, split around its openings, and a flat roof', () => {
    const b = buildOutbuilding(garage);
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
    const b = buildOutbuilding(garage);
    const lengths = b.walls
      .filter((w) => w.id.endsWith(':full') && w.id.split(':')[1] === '1')
      .map((w) => w.size[0]);
    expect(lengths).toEqual([expect.closeTo(5.81 + 0.24, 6)]);
  });

  it('leaves open edges without walls', () => {
    const b = buildOutbuilding(passage);
    expect(new Set(b.walls.map((w) => w.id.split(':')[1]))).toEqual(new Set(['0']));
    expect(b.openings.map((o) => o.id)).toEqual(['passage-arch']);
  });

  it('are part of the scene and its bounds', () => {
    const scene = buildHome(home());
    expect(scene.outbuildings.map((b) => b.id)).toEqual([
      'garage',
      'entrance-passage',
      'shed-ground-floor-garden',
      'compost-ground-floor-garden',
    ]);
    const shed = scene.outbuildings.find((b) => b.kind === 'shed')!;
    expect(shed.openings.map((o) => o.type)).toEqual(['door']);
    expect(shed.roof.top).toBeCloseTo(-0.05 + 2 + SURFACE_OFFSET);
    const compost = scene.outbuildings.find((b) => b.kind === 'compost')!;
    expect(compost.roof.top).toBeCloseTo(-0.05 + 0.9 + SURFACE_OFFSET);
    expect(compost.walls).toHaveLength(4);
    expect(scene.bounds.min[0]).toBeLessThanOrEqual(-4.85);
  });

  it('bound their rotated walls exactly, without terrain around them', () => {
    const model = home();
    model.terrain.patches = model.terrain.patches.filter((p) => p.id === 'terrain-light-well');
    // A flat roof keeps the house within its footprint (z >= -10.77), no overhang.
    model.building.roof = { type: 'flat' };
    const { min } = buildHome(model).bounds;
    // The garage's outside faces reach x -4.85 and z -10.95 (its walls along z included); wall
    // centres alone would give -10.83.
    expect(min[0]).toBeCloseTo(-4.85);
    expect(min[2]).toBeCloseTo(-10.95);
  });
});

describe('roof windows', () => {
  it('lie on their roof plane, just above its top surface', () => {
    const model = home();
    const scene = buildHome(model);
    const gable = gableOf(model, scene.levels.at(-1))!;
    const w = scene.roofWindows.find((r) => r.id === 'roof-window-south');
    expect(w).toMatchObject({ id: 'roof-window-south', levelId: 'first-floor', rotationY: 0 });
    expect(w!.tilt).toBeCloseTo((29 * Math.PI) / 180);
    expect(w!.size).toEqual([0.8, expect.any(Number), 1.35]);
    // Along the ridge from the footprint's west end; on the south (max z) plane.
    expect(w!.center[0]).toBeCloseTo(0.18 + 7.92 + 0.4);
    expect(w!.center[2]).toBeGreaterThan(gable.ridge);
    const top = roofUnderside(gable, w!.center[2]) + gable.thickness * Math.hypot(1, gable.slope);
    expect((w!.center[1] - top) * Math.cos(w!.tilt)).toBeCloseTo(w!.size[1] / 2);
  });

  it('a chimney stands out of the roof from inside it, its flues on top', () => {
    const model = home();
    const scene = buildHome(model);
    const gable = gableOf(model, scene.levels.at(-1))!;
    const [chimney] = scene.chimneys;
    expect(chimney).toMatchObject({ id: 'roof-chimney', levelId: 'first-floor' });
    const { center, size } = chimney!.stack;
    expect(size[0]).toBeCloseTo(1.3);
    expect(size[2]).toBeCloseTo(0.8);
    expect(center[1] + size[1] / 2).toBeCloseTo(7.05);
    // Its foot is inside the roof where the roof is lowest under it: no gap on the lower side.
    const t = gable.thickness * Math.hypot(1, gable.slope);
    const lowest = roofUnderside(gable, center[2] - size[2] / 2) + t;
    expect(center[1] - size[1] / 2).toBeLessThan(lowest);
    expect(center[1] - size[1] / 2).toBeGreaterThan(lowest - t);
    expect(chimney!.flues.map((f) => [f.diameter, f.center[1] + f.height / 2])).toEqual([
      [0.25, expect.closeTo(8.2)],
      [0.08, expect.closeTo(7.4)],
    ]);
    for (const f of chimney!.flues) expect(f.center[1] - f.height / 2).toBeCloseTo(7.05);
    expect(chimney!.finish.tint).toBe('#41403f');
  });

  it('a chimney takes the facade finish when it names none, and needs a gable roof', () => {
    const model = home();
    const roof = model.building.roof as Extract<typeof model.building.roof, { type: 'gable' }>;
    delete roof.chimneys![0]!.finish;
    expect(buildHome(model).chimneys[0]!.finish).toMatchObject({
      finish: 'render.facade',
      tint: '#e5e3de',
    });
    model.building.roof = { type: 'flat' };
    expect(buildHome(model).chimneys).toEqual([]);
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
    expect(visibleScene(scene, wholeVisibility(scene)).roofWindows).toHaveLength(1);
    const attic = { ...wholeVisibility(scene), maxLevelIndex: 2 };
    expect(visibleScene(scene, attic).roofWindows).toEqual([]);
    expect(visibleScene(scene, attic).outbuildings).toHaveLength(4);
  });
});
