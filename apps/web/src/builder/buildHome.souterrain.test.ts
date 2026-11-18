import { HomeModel } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import realHomeJson from '../../../../data/homes/home.json';
import { collisions, createContext, createItem } from '../editor/operations';
import { roomAt } from '../editor/placement';
import { furniture } from '../catalog/furniture';
import {
  boxCorners,
  buildFence,
  buildHome,
  buildStair,
  centroid,
  CONTOUR_INTERVAL,
  FENCE_BAY,
  MAX_RISER,
  slopeContours,
  slopeY,
  SURFACE_OFFSET,
  type Box,
  type Vec2,
} from './buildHome';
import { wholeVisibility, roomLabels, visibleScene } from './visibility';

const home = () => HomeModel.parse(structuredClone(realHomeJson));
const dim = (value: number) => ({ value, source: 'mock' as const });
const point = (x: number, z: number) => ({ x: dim(x), z: dim(z) });
/** Plan bounds of a box: [minX, maxX, minZ, maxZ]. */
const planBounds = (box: Box) => {
  const corners = boxCorners(box);
  const xs = corners.map((c) => c[0]);
  const zs = corners.map((c) => c[2]);
  return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)] as const;
};

const SOUTERRAIN_ROOMS = [
  'Stair hall',
  'Work room',
  'Bath room',
  'Kitchen',
  'Corridor',
  'Living room',
  'Boiler room',
  'Bed room',
];

describe('the souterrain rooms', () => {
  const scene = buildHome(home());
  const floors = scene.roomFloors.filter((r) => r.levelId === 'souterrain');

  it('get a floor each, on the souterrain floor, labelled in the middle', () => {
    expect(floors.map((r) => r.name)).toEqual(SOUTERRAIN_ROOMS);
    for (const floor of floors) {
      expect(floor.y).toBeCloseTo(-2.6 + SURFACE_OFFSET);
      expect(floor.apartmentId).toBe('apt-souterrain');
    }
    const corridor = floors.find((r) => r.roomId === 'souterrain-corridor')!;
    expect(corridor.labelAt[0]).toBeCloseTo((3.45 + 13.06) / 2);
    expect(corridor.labelAt[1]).toBe(corridor.y);
    expect(corridor.labelAt[2]).toBeCloseTo(-6);
  });

  it('finds the centroid of an L-shaped room, not the mean of its corners', () => {
    const l: Vec2[] = [
      [0, 0],
      [4, 0],
      [4, 1],
      [1, 1],
      [1, 4],
      [0, 4],
    ];
    const [x, z] = centroid(l);
    expect(x).toBeCloseTo(19 / 14);
    expect(z).toBeCloseTo(19 / 14);
    expect(centroid([...l].reverse())[0]).toBeCloseTo(19 / 14);
  });

  it('are divided by interior walls of the clear height, split around their doors', () => {
    const interior = scene.walls.filter((w) => w.kind === 'interior' && w.levelId === 'souterrain');
    expect(new Set(interior.map((w) => w.wallId)).size).toBe(12);
    for (const w of interior) {
      expect(w.center[1] + w.size[1] / 2).toBeLessThanOrEqual(-0.25 + 1e-9);
      expect(w.size[2]).toBe(0.12);
    }
    // The bed room wall runs east from x = 8.55 along z = -5.4; its door is 1.8 m in, 0.85 wide.
    const parts = interior.filter((w) => w.wallId === 'souterrain-wall-corridor-bed-room');
    expect(parts.map((w) => w.id.split(':').slice(1).join(':'))).toEqual([
      '0:full',
      '1:above',
      '2:full',
    ]);
    expect(parts[0]!.size[0]).toBeCloseTo(1.8);
    expect(parts[1]!.center[0]).toBeCloseTo(8.55 + 1.8 + 0.425);
    expect(parts[1]!.size[1]).toBeCloseTo(2.35 - 2);
    const door = scene.openings.find((o) => o.id === 'door-souterrain-corridor-bed-room')!;
    expect(door).toMatchObject({ type: 'door', levelId: 'souterrain', size: [0.85, 2, 0.12] });
    expect(door.center).toEqual([
      expect.closeTo(10.775),
      expect.closeTo(-2.6 + 1),
      expect.closeTo(-5.4),
    ]);
  });

  it('have a doorway from the corridor into every room except the open kitchen', () => {
    const doors = scene.openings.filter(
      (o) => o.type === 'door' && o.levelId === 'souterrain' && o.size[2] === 0.12,
    );
    expect(doors.map((o) => o.id).sort()).toEqual([
      'door-souterrain-corridor-bath-room',
      'door-souterrain-corridor-bed-room',
      'door-souterrain-corridor-boiler-room',
      'door-souterrain-corridor-living-room',
      'door-souterrain-corridor-stair-hall',
      'door-souterrain-work-room-corridor',
    ]);
  });

  it('leave the kitchen open to the corridor: no wall segment on their boundary', () => {
    // The boundary is z = -6.6 from the bath room wall (x = 9.35) to the east wall (x = 13.06).
    const crossing = scene.walls.filter((w) => {
      const [x0, x1, z0, z1] = planBounds(w);
      return w.levelId === 'souterrain' && x1 > 9.5 && x0 < 13 && z0 < -6.5 && z1 > -6.7;
    });
    expect(crossing).toEqual([]);
    // The same line west of it is walled: the bath room's corridor wall ends at the kitchen.
    const bath = scene.walls.filter((w) => w.wallId === 'souterrain-wall-bath-room-corridor');
    expect(Math.max(...bath.map((w) => planBounds(w)[1]))).toBeCloseTo(9.41);
  });

  it('put the patio door at the east end of the corridor and the east window in the bed room', () => {
    const door = scene.openings.find((o) => o.id === 'door-souterrain-corridor-patio')!;
    expect(door.center[0]).toBeCloseTo(13.24);
    expect(door.center[2]).toBeCloseTo(-6);
    const entry = scene.terrain.find((t) => t.id === 'terrain-entry')!;
    expect(entry.top).toBe(-2.6);
    const zs = entry.outline.map((p) => p[1]);
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([-7.2, -4.8]);
    const window = scene.openings.find((o) => o.id === 'window-souterrain-bed-room-east')!;
    expect(window.center[2]).toBeCloseTo(-3.9);
  });

  it('are listed by the furniture editor, which places items inside the chosen room', () => {
    const ctx = createContext(home(), furniture);
    const plan = ctx.plans.get('souterrain')!;
    expect(plan.rooms.map((r) => r.name)).toEqual(SOUTERRAIN_ROOMS);
    for (const room of plan.rooms) {
      if (room.id === 'souterrain-corridor') continue; // too narrow for a bed
      const item = createItem(ctx, [], {
        id: 'a',
        typeId: 'bed',
        levelId: 'souterrain',
        roomId: room.id,
      });
      expect(item.roomId).toBe(room.id);
      expect(roomAt(plan, [item.position.x, item.position.z])?.id).toBe(room.id);
      expect(collisions(ctx, [item]).size).toBe(0);
    }
  });
});

describe('room names', () => {
  const scene = buildHome(home());
  const base = wholeVisibility(scene);

  it('are shown for the level being looked into, not under the roof', () => {
    expect(roomLabels(scene, base)).toEqual([]);
    const souterrain = roomLabels(scene, { ...base, maxLevelIndex: 0 });
    expect(souterrain.map((l) => l.name)).toEqual(SOUTERRAIN_ROOMS);
    expect(souterrain[0]).toMatchObject({ id: 'souterrain-stair-hall' });
    const ground = roomLabels(scene, { ...base, maxLevelIndex: 1 });
    expect(ground.map((l) => l.id)).toEqual(['ground-floor-interior']);
  });

  it('can be switched off and follow hidden levels and apartments', () => {
    expect(roomLabels(scene, { ...base, maxLevelIndex: 0, showRoomNames: false })).toEqual([]);
    const hidden = { ...base, maxLevelIndex: 1, hiddenLevels: ['ground-floor'] };
    expect(roomLabels(scene, hidden)).toHaveLength(8);
    const noFlat = { ...base, maxLevelIndex: 0, hiddenApartments: ['apt-souterrain'] };
    expect(roomLabels(scene, noFlat)).toEqual([]);
  });
});

describe('stairs', () => {
  const model = home();
  const scene = buildHome(model);
  const stair = scene.stairs[0]!;

  it('climb from the souterrain floor to the ground floor in even steps', () => {
    expect(stair).toMatchObject({ levelId: 'souterrain', toLevelId: 'ground-floor' });
    expect(stair.rise).toBeLessThanOrEqual(MAX_RISER);
    expect(stair.rise).toBeGreaterThan(0.15);
    const tops = stair.steps.map((s) => s.center[1] + s.size[1] / 2);
    tops.forEach((top, i) => expect(top).toBeCloseTo(-2.6 + stair.rise * (i + 1)));
    // The last riser arrives on the upper floor.
    expect(tops.at(-1)! + stair.rise).toBeCloseTo(0);
    // No step hangs in the air: each reaches down to the top of the one below, or the floor.
    stair.steps.forEach((s, i) => {
      const below = i === 0 ? -2.6 : tops[i - 1]!;
      expect(s.center[1] - s.size[1] / 2).toBeLessThanOrEqual(below + 1e-9);
    });
  });

  it('turn counter-clockwise going up: north, then west, then south', () => {
    expect(stair.turn).toBe('counter-clockwise');
    expect(stair.steps.map((s) => s.part).filter((p) => p === 'landing')).toHaveLength(2);
    const [first, last] = [stair.steps[0]!, stair.steps.at(-1)!];
    const landings = stair.steps.filter((s) => s.part === 'landing');
    // Up the east side going north, across the north end going west, back south on the west.
    expect(landings[0]!.center[2]).toBeLessThan(first.center[2]);
    expect(landings[0]!.center[0]).toBeCloseTo(first.center[0]);
    expect(landings[1]!.center[0]).toBeLessThan(landings[0]!.center[0]);
    expect(landings[1]!.center[2]).toBeCloseTo(landings[0]!.center[2]);
    expect(last.center[2]).toBeGreaterThan(landings[1]!.center[2]);
    expect(last.center[0]).toBeCloseTo(landings[1]!.center[0]);
  });

  it('report the turn of a mirrored and of a straight stair', () => {
    const source = model.stairs![0]!;
    const mirrored = {
      ...source,
      path: [point(0, 0), point(0, -2), point(2, -2), point(2, 0)],
    };
    expect(buildStair(mirrored, 0, 2.6).turn).toBe('clockwise');
    const straight = buildStair({ ...source, path: [point(0, 0), point(3, 0)] }, 0, 1.9);
    expect(straight.turn).toBe('straight');
    expect(straight.steps).toHaveLength(9);
    expect(straight.steps.every((s) => s.part === 'tread')).toBe(true);
    expect(straight.steps[0]!.size).toEqual([expect.closeTo(3 / 9), expect.closeTo(0.19), 1]);
    expect(straight.well).toEqual([
      [expect.closeTo(0), -0.5],
      [expect.closeTo(3), -0.5],
      [expect.closeTo(3), 0.5],
      [expect.closeTo(0), 0.5],
    ]);
  });

  it('never exceed the maximum riser, however the treads divide over the flights', () => {
    const source = model.stairs![0]!;
    // Three equal flights of 2 m (after the landings) and a 2.4 m rise: 13 risers are needed, so
    // 10 treads over three flights; rounding each share of 3.33 down would leave only 12 risers.
    const equal = buildStair(
      { ...source, path: [point(0, 0), point(0, -2.5), point(3, -2.5), point(3, 0)] },
      0,
      2.4,
    );
    expect(equal.rise).toBeLessThanOrEqual(MAX_RISER + 1e-9);
    expect(equal.steps.filter((s) => s.part === 'tread')).toHaveLength(10);
    expect(equal.rise).toBeCloseTo(2.4 / 13);
    for (const rise of [0.5, 1.1, 2.4, 2.6, 2.75, 3.3, 5]) {
      for (const far of [1.2, 2.5, 4, 7.3]) {
        const stair = buildStair(
          { ...source, path: [point(0, 0), point(0, -far), point(3, -far), point(3, 1)] },
          0,
          rise,
        );
        expect(stair.rise).toBeLessThanOrEqual(MAX_RISER + 1e-9);
        expect((stair.steps.length + 1) * stair.rise).toBeCloseTo(rise);
      }
    }
  });

  it('stay inside the stair hall and clear of the corridor door', () => {
    const hall = scene.roomFloors.find((r) => r.roomId === 'souterrain-stair-hall')!;
    const xs = hall.outline.map((p) => p[0]);
    const zs = hall.outline.map((p) => p[1]);
    for (const step of stair.steps) {
      const [x0, x1, z0, z1] = planBounds(step);
      expect(x0).toBeGreaterThanOrEqual(Math.min(...xs));
      expect(x1).toBeLessThanOrEqual(Math.max(...xs));
      expect(z0).toBeGreaterThanOrEqual(Math.min(...zs));
      // The door from the corridor is at the south end of the hall (z > -6.6).
      expect(z1).toBeLessThan(-6.6 - 1);
    }
  });

  it('open a stairwell in the floor slab and the room floor of the level above', () => {
    const slab = scene.slabs.find((s) => s.id === 'ground-floor:floor')!;
    expect(slab.holes).toEqual([stair.well]);
    expect(scene.slabs.find((s) => s.id === 'souterrain:floor')!.holes).toEqual([]);
    const floor = scene.roomFloors.find((r) => r.roomId === 'ground-floor-interior')!;
    expect(floor.holes).toEqual([stair.well]);
    expect(
      scene.roomFloors.find((r) => r.roomId === 'souterrain-stair-hall')!.holes,
    ).toBeUndefined();
    const xs = stair.well.map((p) => p[0]);
    const zs = stair.well.map((p) => p[1]);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([expect.closeTo(0.4), expect.closeTo(3.35)]);
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([
      expect.closeTo(-10.55),
      expect.closeTo(-8.43),
    ]);
  });

  it('are hidden with their level or apartment', () => {
    const base = wholeVisibility(scene);
    expect(visibleScene(scene, { ...base, maxLevelIndex: 0 }).stairs).toHaveLength(1);
    expect(visibleScene(scene, { ...base, hiddenLevels: ['souterrain'] }).stairs).toEqual([]);
    expect(visibleScene(scene, { ...base, hiddenApartments: ['apt-souterrain'] }).stairs).toEqual(
      [],
    );
  });
});

describe('fences', () => {
  const fence = (id: string) => home().fences!.find((f) => f.id === id)!;

  it('stand as posts at most a bay apart with a panel in between', () => {
    const north = buildFence(fence('fence-north'));
    // 28.3 m from x = 19.3 west to x = -9, along z = -17.
    expect(north.panels).toHaveLength(Math.ceil(28.3 / FENCE_BAY));
    expect(north.posts).toHaveLength(north.panels.length + 1);
    expect(north.posts[0]!.center[0]).toBeCloseTo(19.3);
    expect(north.posts.at(-1)!.center[0]).toBeCloseTo(-9);
    for (const panel of north.panels) {
      expect(panel.size[0]).toBeLessThanOrEqual(FENCE_BAY);
      expect(panel.size[1]).toBe(1);
      expect(panel.center[1]).toBeCloseTo(-1.65 + 0.5);
      expect(panel.center[2]).toBeCloseTo(-17);
    }
    const length = north.panels.reduce((sum, p) => sum + p.size[0], 0);
    expect(length).toBeCloseTo(28.3);
  });

  it('step down bay by bay where the ground falls along them', () => {
    const patio = buildFence(fence('fence-east-patio'));
    const bottoms = patio.panels.map((p) => p.center[1] - p.size[1] / 2);
    bottoms.slice(1).forEach((y, i) => expect(y).toBeLessThan(bottoms[i]!));
    expect(bottoms[0]!).toBeLessThan(-0.94);
    expect(bottoms.at(-1)!).toBeGreaterThan(-1.32);
    // Posts reach from below the lower to above the higher of their two panels.
    patio.posts.slice(1, -1).forEach((post, i) => {
      const [before, after] = [patio.panels[i]!, patio.panels[i + 1]!];
      expect(post.center[1] - post.size[1] / 2).toBeLessThanOrEqual(
        after.center[1] - after.size[1] / 2,
      );
      expect(post.center[1] + post.size[1] / 2).toBeGreaterThanOrEqual(
        before.center[1] + before.size[1] / 2,
      );
    });
  });

  it('turn corners with one post each and thicker pillars for a trellis', () => {
    const corner = buildFence({
      ...fence('fence-west-driveway'),
      path: [point(0, 0), point(2, 0), point(2, 2)],
    });
    expect(corner.posts.map((p) => [p.center[0], p.center[2]])).toEqual([
      [0, 0],
      [2, 0],
      [2, 2],
    ]);
    expect(corner.panels.map((p) => p.rotationY)).toEqual([expect.closeTo(0), -Math.PI / 2]);
    const metal = buildFence(fence('fence-north'));
    expect(corner.posts[0]!.size[0]).toBeGreaterThan(metal.posts[0]!.size[0]);
  });

  it('are part of the scene, with the gate at the north end of the patio fence', () => {
    const scene = buildHome(home());
    expect(scene.fences).toHaveLength(7);
    const gate = scene.fences.find((f) => f.kind === 'gate')!;
    expect(gate.panels).toHaveLength(1);
    expect(gate.id).toBe('gate-souterrain-patio-lane');
    expect(gate.panels[0]!.center[2]).toBeCloseTo(-6.65);
    expect(
      visibleScene(scene, { ...wholeVisibility(scene), maxLevelIndex: 0 }).fences,
    ).toHaveLength(7);
  });
});

describe('slope contours', () => {
  const scene = buildHome(home());
  const area = (id: string) => scene.outdoorAreas.find((a) => a.id === id)!;

  it('mark every 0.2 m of fall across a sloped area, lying on the slope', () => {
    const embankment = area('garden-divider');
    expect(embankment.kind).toBe('embankment');
    // 1.6 m of fall over 1 m: a line every 0.125 m, none on the top and bottom edges.
    expect(embankment.contours).toHaveLength(7);
    embankment.contours.forEach((c, i) => {
      const zs = c.outline.map((p) => p[1]);
      const mid = (Math.min(...zs) + Math.max(...zs)) / 2;
      expect(mid).toBeCloseTo(0.5 - 0.125 * (i + 1));
      const xs = c.outline.map((p) => p[0]);
      expect([Math.min(...xs), Math.max(...xs)]).toEqual([13.42, 19.3]);
      const height = slopeY(c.slope!, [15, mid]);
      expect(height - slopeY(embankment.slope!, [15, mid])).toBeCloseTo(SURFACE_OFFSET);
      expect(height).toBeCloseTo(-0.05 - CONTOUR_INTERVAL * (i + 1) + 2 * SURFACE_OFFSET);
    });
  });

  it('are closer together the steeper the slope, and absent on level ground', () => {
    const spacing = (contours: { outline: Vec2[] }[], axis: 0 | 1) =>
      Math.abs(contours[1]!.outline[0]![axis] - contours[0]!.outline[0]![axis]);
    expect(spacing(area('lane').contours, 1)).toBeGreaterThan(
      5 * spacing(area('garden-divider').contours, 1),
    );
    expect(area('patio-souterrain').contours).toEqual([]);
    expect(area('drainage-north-east')).toMatchObject({ kind: 'gravel', contours: [] });
    const east = slopeContours(
      [
        [0, 0],
        [1, 0],
        [1, 3],
        [0, 3],
      ],
      { axis: 'x', from: 0, to: 1, high: 0, low: -0.5 },
    );
    expect(east).toHaveLength(2);
    expect(east[0]!.outline.map((p) => p[1])).toEqual([0, 0, 3, 3]);
    expect(east[0]!.outline[0]![0]).toBeCloseTo(0.4 - 0.04);
  });

  it('are clipped to the outline, not its bounding box', () => {
    // A U-shaped area falling east: 4 m wide at the west, two 1 m prongs east of x = 1.
    const u: Vec2[] = [
      [0, 0],
      [2, 0],
      [2, 1],
      [1, 1],
      [1, 3],
      [2, 3],
      [2, 4],
      [0, 4],
    ];
    const contours = slopeContours(u, { axis: 'x', from: 0, to: 2, high: 0, low: -0.6 });
    const spans = contours.map((c) => {
      const zs = c.outline.map((p) => p[1]);
      return [c.outline[0]![0] + 0.04, Math.min(...zs), Math.max(...zs)];
    });
    // One full-width line in the base (x = 0.67), then one per prong (x = 1.33).
    expect(spans).toEqual([
      [expect.closeTo(2 / 3), 0, 4],
      [expect.closeTo(4 / 3), 0, 1],
      [expect.closeTo(4 / 3), 3, 4],
    ]);
    // A triangle narrows the lines towards its tip.
    const triangle = slopeContours(
      [
        [0, 0],
        [4, 2],
        [0, 4],
      ],
      { axis: 'x', from: 0, to: 4, high: 0, low: -0.5 },
    );
    const widths = triangle.map((c) => c.outline[2]![1] - c.outline[0]![1]);
    expect(widths).toEqual([expect.closeTo(2.4), expect.closeTo(0.8)]);
  });
});
