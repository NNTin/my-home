import { HomeModel, wallLength } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import realHomeJson from '../../../../data/homes/home.json';
import mockHomeJson from '../../../../packages/shared/test-fixtures/mock-home.json';
import {
  buildHome,
  boxCorners,
  gableOf,
  gableRoofPlanes,
  SHELL_DETAIL,
  solidPoint,
  SURFACE_OFFSET,
} from './buildHome';
import { groupShown, shellItems } from './drawList';
import { defaultVisibility, visibleScene, wholeVisibility } from './visibility';

// Shell detail (docs/design/realistic-render.md §8.1): skirting, door reveals and thresholds,
// and the trim of the roof, as builder descriptors and draw items.

const model = HomeModel.parse(structuredClone(realHomeJson));
const home = buildHome(model);
const mock = buildHome(HomeModel.parse(structuredClone(mockHomeJson)));
const items = shellItems(home);
const item = (id: string) => items.find((i) => i.id === id)!;
const wallOf = (id: string) => model.walls.find((w) => w.id === id)!;

describe('skirting', () => {
  const { height, depth } = SHELL_DETAIL.skirting;

  it('is 7 cm high and 1.2 cm deep, at the foot of the wall faces of the souterrain rooms', () => {
    expect([height, depth]).toEqual([0.07, 0.012]);
    expect(home.skirting.length).toBeGreaterThan(40);
    const rooms = new Set(model.rooms.filter((r) => r.levelId === 'souterrain').map((r) => r.id));
    expect(new Set(home.skirting.map((s) => s.roomId))).toEqual(rooms);
    for (const s of home.skirting) {
      expect(s.levelId).toBe('souterrain');
      const wall = wallOf(s.wallId);
      // From the wall's foot to 7 cm above the floor's surface.
      expect(s.size[1]).toBeCloseTo(SURFACE_OFFSET + height, 9);
      expect(s.center[1] - s.size[1] / 2).toBeCloseTo(-2.6, 9);
      // A board on a long face is as deep as a skirting; one around an end as wide as the wall.
      const onEnd = /skirting:(start|end)$/.test(s.id);
      expect(s.size[2]).toBeCloseTo(onEnd ? wall.thickness.value + 2 * depth : depth, 9);
      // It lies against the face: its middle is half a wall and half a board from the wall's line.
      const [sx, sz] = [wall.start.x.value, wall.start.z.value];
      const length = wallLength(wall);
      const [dx, dz] = [(wall.end.x.value - sx) / length, (wall.end.z.value - sz) / length];
      const across = Math.abs((s.center[0] - sx) * -dz + (s.center[2] - sz) * dx);
      expect(across).toBeCloseTo(onEnd ? 0 : (wall.thickness.value + depth) / 2, 9);
    }
  });

  it('is broken at every door, and runs under the windows', () => {
    const doors = model.openings.filter(
      (o) => o.sill.value === 0 && o.wallId.startsWith('souterrain'),
    );
    expect(doors.length).toBe(7);
    for (const door of doors) {
      const wall = wallOf(door.wallId);
      const [sx, sz] = [wall.start.x.value, wall.start.z.value];
      const length = wallLength(wall);
      const [dx, dz] = [(wall.end.x.value - sx) / length, (wall.end.z.value - sz) / length];
      const mid = door.offset.value + door.width.value / 2;
      for (const s of home.skirting.filter((x) => x.wallId === wall.id && x.size[2] === depth)) {
        const along = (s.center[0] - sx) * dx + (s.center[2] - sz) * dz;
        // The middle of the doorway is not within the board.
        expect(Math.abs(along - mid), `${s.id} at ${door.id}`).toBeGreaterThanOrEqual(
          s.size[0] / 2 + door.width.value / 2 - 1e-9,
        );
      }
    }
    // The kitchen's outer wall has a window and no door: one board along the whole room.
    const kitchen = home.skirting.filter(
      (s) => s.roomId === 'souterrain-kitchen' && s.wallId === 'souterrain-wall-north',
    );
    expect(kitchen).toHaveLength(1);
    expect(kitchen[0]!.size[0]).toBeCloseTo(3.5 + 2 * depth, 9);
  });

  it('goes around the end of a wall that stands free in a room', () => {
    const end = home.skirting.find(
      (s) => s.id === 'souterrain-wall-bath-room-corridor/skirting:end',
    );
    expect(end).toMatchObject({ roomId: 'souterrain-corridor' });
  });

  it('is not inside the ground floor and the attic, nor in a home’s upper levels', () => {
    expect(home.skirting.some((s) => s.levelId !== 'souterrain')).toBe(false);
    const lowest = mock.levels.find((l) => l.index === 0)!.id;
    expect(mock.skirting.length).toBeGreaterThan(0);
    expect(mock.skirting.every((s) => s.levelId === lowest)).toBe(true);
  });

  it('is drawn with its level, as closed solids a section caps', () => {
    for (const s of home.skirting) {
      expect(item(s.id)).toMatchObject({
        shape: { kind: 'box', size: s.size },
        finish: 'paint.plain',
        closed: true,
        group: { kind: 'level', levelId: 'souterrain' },
      });
    }
    expect(visibleScene(home, defaultVisibility(home)).skirting).toHaveLength(home.skirting.length);
    const hidden = { ...wholeVisibility(home), hiddenLevels: ['souterrain'] };
    expect(visibleScene(home, hidden).skirting).toEqual([]);
  });
});

describe('door reveals and thresholds', () => {
  it('every door at floor level has a reveal: the six inner doors, the three outer ones, the French door', () => {
    expect(home.doorReveals.map((d) => d.openingId).sort()).toEqual(
      model.openings
        .filter((o) => o.type === 'door' || o.type === 'french-door')
        .map((o) => o.id)
        .sort(),
    );
    expect(home.doorReveals).toHaveLength(10);
  });

  it('an inner door is lined through the wall’s depth, in the colour of its frame', () => {
    const inner = home.doorReveals.filter((d) => wallOf(d.wallId).kind === 'interior');
    expect(inner).toHaveLength(6);
    const t = SHELL_DETAIL.lining.thickness;
    for (const d of inner) {
      const door = model.openings.find((o) => o.id === d.openingId)!;
      const depth = wallOf(d.wallId).thickness.value;
      expect(d.parts.map((p) => p.part)).toEqual(['jamb', 'jamb', 'head', 'threshold']);
      const [left, right, head, threshold] = d.parts;
      for (const jamb of [left!, right!]) expect(jamb.size).toEqual([t, door.height.value, depth]);
      expect(head!.size[0]).toBeCloseTo(door.width.value - 2 * t, 9);
      expect(head!.size.slice(1)).toEqual([t, depth]);
      // The head's top is the top of the hole; the jambs stand in the hole's two sides.
      expect(head!.center[1] + t / 2).toBeCloseTo(-2.6 + door.height.value, 9);
      const frame = home.openings.find((o) => o.id === door.id)!;
      const span = Math.hypot(
        left!.center[0] - right!.center[0],
        left!.center[2] - right!.center[2],
      );
      expect(span).toBeCloseTo(door.width.value - t, 9);
      expect(left!.center[1]).toBeCloseTo(frame.center[1], 9);
      for (const p of d.parts) {
        expect(p.finish).toEqual({
          finish: 'paint.plain',
          tint: frame.values.frameColor,
          rotation: 0,
        });
        expect(p.rotationY).toBe(frame.rotationY);
      }
      expect(threshold!.size[0]).toBeCloseTo(door.width.value, 9);
      expect(threshold!.size[2]).toBe(depth);
    }
  });

  it('a threshold lies across the doorway through the whole wall, a centimetre over the floor', () => {
    for (const d of home.doorReveals) {
      const threshold = d.parts.at(-1)!;
      const base = home.levels.find((l) => l.id === d.levelId)!.elevation;
      expect(threshold.part).toBe('threshold');
      expect(threshold.size[1]).toBeCloseTo(SURFACE_OFFSET + SHELL_DETAIL.threshold.height, 9);
      expect(threshold.center[1] - threshold.size[1] / 2).toBeCloseTo(base, 9);
      expect(threshold.size[2]).toBe(wallOf(d.wallId).thickness.value);
      // It stays within the wall: no corner is outside the opening's own box.
      const opening = home.openings.find((o) => o.id === d.openingId)!;
      expect(threshold.center[0]).toBeCloseTo(opening.center[0], 9);
      expect(threshold.center[2]).toBeCloseTo(opening.center[2], 9);
    }
  });

  it('an outer door has a threshold and no lining: its reveal is the wall’s own', () => {
    const outer = home.doorReveals.filter((d) => wallOf(d.wallId).kind === 'exterior');
    expect(outer).toHaveLength(4);
    for (const d of outer) {
      expect(d.parts.map((p) => p.part)).toEqual(['threshold']);
      expect(d.parts[0]!.finish).toBe(SHELL_DETAIL.threshold.finish);
      // The wall's reveal faces line the opening: indoors the room's finish, outdoors the facade.
      const reveals = home.wallFaces.filter((f) => f.openingId === d.openingId);
      expect(reveals).toHaveLength(6);
      expect(new Set(reveals.map((f) => f.finish.finish)).has('render.facade')).toBe(true);
    }
    const patio = home.wallFaces.filter((f) => f.openingId === 'door-souterrain-corridor-patio');
    // The door to the patio stands where the kitchen opens to the corridor.
    expect(new Set(patio.map((f) => f.roomId))).toEqual(new Set([undefined, 'souterrain-kitchen']));
    expect(new Set(patio.map((f) => f.finish.finish))).toEqual(
      new Set(['render.facade', 'paint.plain']),
    );
  });

  it('the frame stays the door piece’s: the same parts as without any reveal', () => {
    const door = home.openings.find((o) => o.id === 'door-souterrain-corridor-bath-room')!;
    expect(door.parts).toHaveLength(3);
    expect(door.parts.every((p) => p.role === 'frame')).toBe(true);
  });

  it('is drawn with its level, as closed boxes', () => {
    for (const d of home.doorReveals) {
      for (const p of d.parts) {
        expect(item(p.id)).toMatchObject({
          shape: { kind: 'box', size: p.size },
          closed: true,
          group: { kind: 'level', levelId: d.levelId },
        });
      }
    }
    const hidden = { ...wholeVisibility(home), hiddenLevels: ['souterrain'] };
    expect(visibleScene(home, hidden).doorReveals.every((d) => d.levelId !== 'souterrain')).toBe(
      true,
    );
  });
});

describe('the trim of the roof', () => {
  const gable = gableOf(model, home.levels.at(-1))!;
  const planes = gableRoofPlanes(gable, home.roofPlanes[0]!.finish);
  const bounds = (id: string) => {
    const trim = home.roofTrim.find((t) => t.id === id)!;
    const xs = trim.outline.map((p) => p[0]);
    const ys = trim.outline.map((p) => p[1]);
    return { x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)], trim };
  };

  it('is an eaves board and a gutter along each eave, and a cap over the ridge', () => {
    expect(home.roofTrim.map((t) => [t.id, t.part])).toEqual([
      ['roof:ridge-cap', 'ridge-cap'],
      ['roof:eaves-board:min', 'eaves-board'],
      ['roof:gutter:min', 'gutter'],
      ['roof:eaves-board:max', 'eaves-board'],
      ['roof:gutter:max', 'gutter'],
    ]);
    for (const t of home.roofTrim) {
      // In the frame of the roof's planes, and as long as they are.
      expect(t.center).toEqual(planes[0]!.center);
      expect(t.rotationY).toBe(planes[0]!.rotationY);
      expect(t.depth).toBe(planes[0]!.depth);
      expect(t.levelId).toBe('first-floor');
    }
  });

  it('leaves the roof’s planes as they are', () => {
    expect(home.roofPlanes).toEqual(planes);
    const noTrim = shellItems({ ...home, roofTrim: [] });
    for (const plane of home.roofPlanes) {
      expect(item(plane.id)).toEqual(noTrim.find((i) => i.id === plane.id));
    }
  });

  it('the board covers the eave’s edge and the gutter hangs in front of it, below the tiles', () => {
    for (const [name, plane] of [
      ['min', planes[0]!],
      ['max', planes[1]!],
    ] as const) {
      const side = name === 'min' ? -1 : 1;
      // The plane's eave edge: its outer two points.
      const [low, high] = [plane.outline[1]!, plane.outline[2]!];
      const board = bounds(`roof:eaves-board:${name}`);
      expect(side < 0 ? board.x[1] : board.x[0]).toBeCloseTo(low[0], 9);
      expect(board.x[1]! - board.x[0]!).toBeCloseTo(SHELL_DETAIL.eavesBoard.thickness, 9);
      expect(board.y[1]).toBeCloseTo(high[1], 9);
      expect(board.y[0]).toBeLessThan(low[1]);
      const gutter = bounds(`roof:gutter:${name}`);
      expect(gutter.x[1]! - gutter.x[0]!).toBeCloseTo(2 * SHELL_DETAIL.gutter.radius, 9);
      // Outside the board, its rim below the roof's top edge.
      expect(side < 0 ? gutter.x[1] : gutter.x[0]).toBeCloseTo(
        side < 0 ? board.x[0]! : board.x[1]!,
        9,
      );
      expect(gutter.y[1]).toBeLessThan(high[1]);
      expect(gutter.trim.finish.finish).toBe('metal.brushed');
    }
  });

  it('the cap lies on the ridge, on both planes, in the roof’s finish', () => {
    const cap = bounds('roof:ridge-cap');
    const ridge = planes[0]!.outline[3]!;
    expect(cap.x).toEqual([-SHELL_DETAIL.ridgeCap.halfWidth, SHELL_DETAIL.ridgeCap.halfWidth]);
    expect(cap.y[1]).toBeCloseTo(ridge[1] + SHELL_DETAIL.ridgeCap.thickness, 9);
    expect(cap.trim.outline).toContainEqual([0, ridge[1]]);
    expect(cap.trim.finish).toEqual(home.roofPlanes[0]!.finish);
  });

  it('is drawn and hidden with the roof, as closed solids', () => {
    for (const t of home.roofTrim) {
      expect(item(t.id)).toMatchObject({
        shape: { kind: 'profile', outline: t.outline, depth: t.depth },
        closed: true,
        group: { kind: 'roof', levelId: 'first-floor' },
      });
      expect(groupShown(item(t.id).group, home, defaultVisibility(home))).toBe(false);
    }
    expect(visibleScene(home, defaultVisibility(home)).roofTrim).toEqual([]);
    expect(visibleScene(home, wholeVisibility(home)).roofTrim).toHaveLength(5);
  });

  it('a home with a flat roof has none', () => {
    const flat = structuredClone(realHomeJson) as { building: { roof?: unknown } };
    delete flat.building.roof;
    expect(buildHome(HomeModel.parse(flat)).roofTrim).toEqual([]);
  });

  it('stays within a hand’s breadth of the roof: the home’s bounds hardly grow', () => {
    const reach = SHELL_DETAIL.eavesBoard.thickness + 2 * SHELL_DETAIL.gutter.radius;
    for (const t of home.roofTrim) {
      for (const p of t.outline) {
        const [x, , z] = solidPoint(t, p, 0);
        expect(x).toBeGreaterThan(home.bounds.min[0] - reach - 1e-9);
        expect(z).toBeGreaterThan(home.bounds.min[2] - reach - 1e-9);
        expect(z).toBeLessThan(home.bounds.max[2] + reach + 1e-9);
      }
    }
  });
});

describe('what shell detail leaves alone', () => {
  it('the stair is the boxes it was: its rebuild is its own step', () => {
    const [stair] = home.stairs;
    expect(stair!.steps.length).toBeGreaterThan(10);
    for (const step of stair!.steps) {
      expect(item(step.id).shape).toEqual({ kind: 'box', size: step.size });
      expect(boxCorners(step)).toHaveLength(8);
    }
    expect(items.some((i) => /stringer|handrail|nosing/.test(i.id))).toBe(false);
  });
});
