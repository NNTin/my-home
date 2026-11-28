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
  centroid,
  FENCE_BAY,
  slopeY,
  SURFACE_OFFSET,
} from './buildHome';
import type { Box, Vec2 } from '../geom/types';
import { shellItems } from './drawList';
import {
  defaultVisibility,
  roomLabels,
  showUpTo,
  visibleScene,
  wholeVisibility,
} from './visibility';

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
    expect(corridor.labelAt[0]).toBeCloseTo((2.715 + 12.94) / 2);
    expect(corridor.labelAt[1]).toBe(corridor.y);
    expect(corridor.labelAt[2]).toBeCloseTo((-7.265 - 5.91) / 2);
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
      expect(w.size[2]).toBe(0.24);
    }
    // The bed room wall runs east from x = 8.93 along z = -5.91; its door is 1.295 m in, 0.82 wide (the owner's wall opening).
    const parts = interior.filter((w) => w.wallId === 'souterrain-wall-corridor-bed-room');
    expect(parts.map((w) => w.id.split(':').slice(1).join(':'))).toEqual([
      '0:full',
      '1:above',
      '2:full',
    ]);
    expect(parts[0]!.size[0]).toBeCloseTo(1.295);
    expect(parts[1]!.center[0]).toBeCloseTo(8.93 + 1.295 + 0.41);
    expect(parts[1]!.size[1]).toBeCloseTo(2.35 - 2);
    const door = scene.openings.find((o) => o.id === 'door-souterrain-corridor-bed-room')!;
    expect(door).toMatchObject({ type: 'door', levelId: 'souterrain', size: [0.82, 2, 0.24] });
    expect(door.center).toEqual([
      expect.closeTo(10.635),
      expect.closeTo(-2.6 + 1),
      expect.closeTo(-5.91),
    ]);
  });

  it('have a doorway from the corridor into every room except the open kitchen', () => {
    const doors = scene.openings.filter(
      (o) => o.type === 'door' && o.levelId === 'souterrain' && o.size[2] === 0.24,
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
    // The boundary is z = -7.265 from the bath room wall (x = 9.44, faces 9.32 to 9.56) to the
    // east wall (inner face x = 12.94).
    const crossing = scene.walls.filter((w) => {
      const [x0, x1, z0, z1] = planBounds(w);
      return w.levelId === 'souterrain' && x1 > 9.6 && x0 < 12.9 && z0 < -7.165 && z1 > -7.365;
    });
    expect(crossing).toEqual([]);
    // The same line west of it is walled: the bath room's corridor wall ends at the kitchen.
    const bath = scene.walls.filter((w) => w.wallId === 'souterrain-wall-bath-room-corridor');
    expect(Math.max(...bath.map((w) => planBounds(w)[1]))).toBeCloseTo(9.56);
  });

  it('put the patio door at the east end of the corridor and the east window in the bed room', () => {
    const door = scene.openings.find((o) => o.id === 'door-souterrain-corridor-patio')!;
    // On the east wall's centre line, where the corridor's open end meets the kitchen (from photos).
    expect(door.center[0]).toBeCloseTo(13.18);
    expect(door.center[2]).toBeCloseTo(-7.4);
    const entry = scene.terrain.find((t) => t.id === 'terrain-entry')!;
    expect(entry.top).toBe(-2.6);
    const zs = entry.outline.map((p) => p[1]);
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([-8.1, -6.7]);
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
        typeId: 'furniture.bed',
        levelId: 'souterrain',
        roomId: room.id,
      });
      expect(item.roomId).toBe(room.id);
      expect(roomAt(plan, [item.position.x, item.position.z])?.id).toBe(room.id);
      expect(collisions(ctx, [item]).size).toBe(0);
    }
  });
});

describe('lowered ceilings', () => {
  const scene = buildHome(home());
  const byId = (id: string) => scene.ceilings.find((c) => c.id === id)!;

  it('hang from the slab above down to their height: the corridor and kitchen, and the box', () => {
    expect(scene.ceilings.map((c) => c.id)).toEqual([
      'souterrain-ceiling-corridor-kitchen',
      'souterrain-ceiling-corridor-box',
    ]);
    const suspended = byId('souterrain-ceiling-corridor-kitchen');
    expect(suspended.bottom).toBeCloseTo(-2.6 + 2.15);
    expect(suspended.top).toBeCloseTo(-2.6 + 2.35 - SURFACE_OFFSET);
    const box = byId('souterrain-ceiling-corridor-box');
    expect(box.bottom).toBeCloseTo(-2.6 + 2.0);
    // Across the corridor, from the Bath room door's east casing to the end of its north wall.
    expect(Math.min(...box.outline.map((p) => p[0]))).toBeCloseTo(8.2);
    expect(Math.max(...box.outline.map((p) => p[0]))).toBeCloseTo(9.56);
    const bath = scene.openings.find((o) => o.id === 'door-souterrain-corridor-bath-room')!;
    expect(bath.center[0] + bath.size[0] / 2).toBeLessThan(8.2);
    // Every door of the souterrain fits under the suspended ceiling.
    for (const o of scene.openings.filter((o) => o.levelId === 'souterrain' && o.type === 'door'))
      expect(o.center[1] + o.size[1] / 2).toBeLessThanOrEqual(suspended.bottom + 1e-9);
  });

  it('show with the level above, so the cutaway still looks into the rooms', () => {
    expect(visibleScene(scene, defaultVisibility(scene)).ceilings).toEqual([]);
    const ground = scene.levels.find((l) => l.id === 'ground-floor')!;
    const upToGround = showUpTo(scene, defaultVisibility(scene), ground.index);
    expect(visibleScene(scene, upToGround).ceilings).toHaveLength(2);
    expect(visibleScene(scene, wholeVisibility(scene)).ceilings).toHaveLength(2);
    expect(
      visibleScene(scene, { ...wholeVisibility(scene), hiddenLevels: ['souterrain'] }).ceilings,
    ).toEqual([]);
    expect(
      visibleScene(scene, { ...wholeVisibility(scene), hiddenApartments: ['apt-souterrain'] })
        .ceilings,
    ).toEqual([]);
  });

  it('are none when the model has none', () => {
    const model = home();
    delete model.ceilings;
    expect(buildHome(model).ceilings).toEqual([]);
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

/** The signed area of an outline: positive when it runs anticlockwise. */
const area = (outline: Vec2[]) =>
  outline.reduce((sum, [x, y], i) => {
    const [nx, ny] = outline[(i + 1) % outline.length]!;
    return sum + (x * ny - nx * y) / 2;
  }, 0);
const length = ([a, b]: readonly [Vec2, Vec2]) => Math.hypot(b[0] - a[0], b[1] - a[1]);

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

  it('turn corners with one post each; a trellis stands on wooden posts', () => {
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
    // Its brick pillar is a catalogue piece (garden.pillar), not a post (#147).
    expect(corner.posts[0]!.size[0]).toBe(0.07);
  });

  it('a privacy fence is upright boards from post to post, a centimetre apart', () => {
    const garden = buildFence(fence('fence-east-souterrain-garden'));
    const bay = garden.panels[0]!;
    const boards = garden.slats.filter((s) => s.id.startsWith(`${bay.id}:`));
    expect(boards.length).toBeGreaterThan(15);
    const span = (s: { outline: Vec2[] }, axis: 0 | 1) => {
      const at = s.outline.map((p) => p[axis]);
      return [Math.min(...at), Math.max(...at)] as const;
    };
    boards.forEach((board, i) => {
      const [x0, x1] = span(board, 0);
      const [y0, y1] = span(board, 1);
      expect(board.center).toEqual(bay.center);
      expect(x1 - x0).toBeGreaterThan(0.09);
      expect(x1 - x0).toBeLessThan(0.13);
      // On the ground, and up to the fence's height or a few centimetres less.
      expect(y0).toBeCloseTo(-bay.size[1] / 2);
      expect(y1).toBeLessThanOrEqual(bay.size[1] / 2 + 1e-9);
      expect(y1).toBeGreaterThan(bay.size[1] / 2 - 0.05);
      if (i > 0) expect(x0 - span(boards[i - 1]!, 0)[1]).toBeCloseTo(0.01);
    });
    // Between the posts' faces, not into the posts.
    expect(span(boards[0]!, 0)[0]).toBeCloseTo(-bay.size[0] / 2 + 0.04);
    expect(span(boards.at(-1)!, 0)[1]).toBeCloseTo(bay.size[0] / 2 - 0.04 - 0.01);
  });

  it('a trellis is a diagonal lattice cut to its bay, between two rails', () => {
    const trellis = buildFence(fence('fence-west-driveway'));
    const bay = trellis.panels[0]!;
    const laths = trellis.slats.filter((s) => s.id.startsWith(`${bay.id}:`));
    const [w, h] = [(bay.size[0] - 0.07) / 2, bay.size[1] / 2];
    for (const lath of laths) {
      expect(lath.outline.length).toBeGreaterThanOrEqual(3);
      for (const [x, y] of lath.outline) {
        expect(Math.abs(x)).toBeLessThanOrEqual(w + 1e-9);
        expect(Math.abs(y)).toBeLessThanOrEqual(h + 1e-9);
      }
    }
    // Two rails, then laths leaning both ways: every lath's long edges run at 45 degrees.
    const leaning = laths.slice(2).map((lath) => {
      const [a, b] = lath.outline
        .map((p, i) => [p, lath.outline[(i + 1) % lath.outline.length]!] as const)
        .sort((e, f) => length(f) - length(e))[0]!;
      return Math.sign((b[0] - a[0]) * (b[1] - a[1]));
    });
    expect(leaning.filter((s) => s > 0).length).toBeGreaterThan(10);
    expect(leaning.filter((s) => s < 0).length).toBe(leaning.filter((s) => s > 0).length);
    // No outline is turned inside out by the cut.
    for (const lath of laths) expect(area(lath.outline)).toBeGreaterThan(0);
  });

  it('a wire mesh hangs between a top and a bottom rail; a gate has no slats', () => {
    const north = buildFence(fence('fence-north'));
    expect(north.slats).toHaveLength(2 * north.panels.length);
    const scene = buildHome(home());
    expect(scene.fences.find((f) => f.kind === 'gate')!.slats).toEqual([]);
    const items = shellItems(scene);
    // The mesh is the only panel that is drawn, and seen through.
    const panels = items.filter((i) => i.id.includes(':panel:') && !i.id.includes(':slat:'));
    expect(panels.length).toBeGreaterThan(0);
    for (const panel of panels) {
      expect(panel.id).toMatch(/^fence-(north|east-garden):/);
      expect(panel.material).toMatchObject({ transparent: true });
    }
    // Posts and slats of a fence are one finish: one mesh a fence, and the mesh one more.
    const slats = items.filter((i) => i.id.includes(':slat:'));
    expect(new Set(slats.map((i) => i.finish))).toEqual(new Set(['paint.plain']));
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

describe('slopes', () => {
  const scene = buildHome(home());
  const area = (id: string) => scene.outdoorAreas.find((a) => a.id === id)!;

  it('are one smooth surface each: a plane from the high edge to the low one, no bands', () => {
    const embankment = area('garden-divider');
    expect(embankment.kind).toBe('embankment');
    // 1.6 m of fall over 1 m, from z = 0.5 down to z = -0.5.
    expect(slopeY(embankment.slope!, [15, 0.5])).toBeCloseTo(-0.05 + SURFACE_OFFSET);
    expect(slopeY(embankment.slope!, [15, 0])).toBeCloseTo(-0.85 + SURFACE_OFFSET);
    expect(slopeY(embankment.slope!, [15, -0.5])).toBeCloseTo(-1.65 + SURFACE_OFFSET);
    expect(area('patio-souterrain').slope).toBeUndefined();
    // One draw item an area, sloped or not: nothing lies on a slope to mark it.
    const items = shellItems(scene).filter((i) => i.group.kind === 'area');
    expect(items.map((i) => i.id)).toEqual(scene.outdoorAreas.map((a) => a.id));
    const sloped = items.filter((i) => i.shape.kind === 'surface' && i.shape.slope);
    expect(sloped.length).toBe(scene.outdoorAreas.filter((a) => a.slope).length);
    expect(sloped.length).toBeGreaterThan(10);
  });
});
