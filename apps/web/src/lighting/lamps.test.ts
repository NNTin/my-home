import { HomeModel, HomeSeed } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import homeJson from '../../../../data/homes/home.json';
import seedJson from '../../../../data/homes/home.seed.json';
import { buildHome, type Vec3 } from '../builder/buildHome';
import { defaultVisibility } from '../builder/visibility';
import { furniture } from '../catalog/furniture';
import { createContext, defaultSettings } from '../editor/operations';
import { furnitureViews } from '../scene/furnitureViews';
import {
  assignPool,
  lampRooms,
  nearest,
  POOL_SIZE,
  roomAt,
  roomRange,
  sceneEmitters,
  SHADOW_LAMPS,
  type Emitter,
  type LampRoom,
} from './lamps';

const room = (id: string, x0: number, x1: number): LampRoom => ({
  id,
  levelId: 'level',
  outline: [
    [x0, 0],
    [x1, 0],
    [x1, 4],
    [x0, 4],
  ],
  floor: 0,
  ceiling: 2.5,
});
const rooms = [room('a', 0, 4), room('b', 4, 8)];

const emitter = (id: string, x: number, roomId = x < 4 ? 'a' : 'b'): Emitter => ({
  id,
  position: [x, 2.25, 2],
  color: '#ffffff',
  intensity: 65,
  range: 6,
  roomId,
});
const empty = (n: number): undefined[] => Array.from({ length: n }, () => undefined);
const everywhere = () => true;

describe('the lamp pool', () => {
  it('has 6 lights on a phone and 12 on a desktop, of which 4 cast shadows there and none on a phone', () => {
    expect(POOL_SIZE).toEqual({ phone: 6, desktop: 12 });
    expect(SHADOW_LAMPS).toEqual({ phone: 0, desktop: 4 });
  });

  it('assigns the emitters nearest the focus, the nearest to the first lights', () => {
    const emitters = [emitter('far', 7), emitter('near', 1), emitter('mid', 3)];
    expect(nearest(emitters, [0, 0, 2]).map((e) => e.id)).toEqual(['near', 'mid', 'far']);
    expect(assignPool(empty(2), emitters, [0, 0, 2], everywhere)).toEqual(['near', 'mid']);
  });

  it('never changes its size, and leaves lights without an emitter unassigned', () => {
    const emitters = [emitter('one', 1)];
    expect(assignPool(empty(6), emitters, [0, 0, 0], everywhere)).toEqual(['one', ...empty(5)]);
    expect(assignPool(empty(6), [], [0, 0, 0], everywhere)).toEqual(empty(6));
  });

  it('keeps a lit lamp that is in sight where it is, however the focus moves', () => {
    const emitters = [emitter('a1', 1), emitter('a2', 3), emitter('b1', 5), emitter('b2', 7)];
    const first = assignPool(empty(2), emitters, [0, 0, 2], everywhere);
    expect(first).toEqual(['a1', 'a2']);
    // The focus moves to the other room while both rooms are seen (an orbit view): nothing jumps.
    expect(assignPool(first, emitters, [8, 0, 2], everywhere)).toEqual(['a1', 'a2']);
  });

  it('reassigns a light only when the room of its emitter is not seen', () => {
    const emitters = [emitter('a1', 1), emitter('a2', 3), emitter('b1', 5), emitter('b2', 7)];
    const first = assignPool(empty(2), emitters, [0, 0, 2], everywhere);
    // The eye is in room b: lamps of room a are out of sight and move over, the nearest first.
    const inB = (e: Emitter) => e.roomId === 'b';
    expect(assignPool(first, emitters, [8, 1.6, 2], inB)).toEqual(['b2', 'b1']);
    // An unassigned light (intensity 0) is free at any time.
    expect(assignPool(['a1', undefined], emitters, [0, 0, 2], everywhere)).toEqual(['a1', 'a2']);
  });

  it('frees the light of an emitter that is gone', () => {
    const emitters = [emitter('a1', 1), emitter('a2', 3)];
    expect(assignPool(['gone', 'a1'], emitters, [0, 0, 2], everywhere)).toEqual(['a2', 'a1']);
  });

  it('ends a range at the bounds of the room: its farthest corner', () => {
    const at: Vec3 = [1, 2.25, 2];
    // The farthest corner is 3 m along x, 2 m along z and 2.25 m down.
    expect(roomRange(at, 6, rooms[0])).toBeCloseTo(Math.hypot(3, 2, 2.25), 6);
    // A shorter declared range stays; without a room the declared range stands.
    expect(roomRange(at, 2, rooms[0])).toBe(2);
    expect(roomRange(at, 6, undefined)).toBe(6);
  });

  it('finds the room a point is in', () => {
    expect(roomAt(rooms, [5, 1.6, 2])?.id).toBe('b');
    expect(roomAt(rooms, [5, 3, 2])).toBeUndefined();
    expect(roomAt(rooms, [9, 1.6, 2])).toBeUndefined();
  });

  it('puts emitters into the world, turned with their item', () => {
    const [e] = sceneEmitters(
      [
        {
          id: 'lamp',
          position: [2, 2.5, 2],
          rotationY: Math.PI / 2,
          roomId: 'a',
          emitters: [{ position: [1, -0.25, 0], color: '#fff0dc', intensity: 65, range: 6 }],
        },
        { id: 'chair', position: [1, 0, 1], rotationY: 0 },
      ],
      rooms,
    );
    expect(e).toMatchObject({ id: 'lamp', color: '#fff0dc', intensity: 65, roomId: 'a' });
    expect(e!.position[0]).toBeCloseTo(2, 6);
    expect(e!.position[1]).toBeCloseTo(2.25, 6);
    expect(e!.position[2]).toBeCloseTo(1, 6);
    expect(e!.range).toBeLessThan(6);
  });
});

describe('the lamps of "Our home"', () => {
  const model = HomeModel.parse(structuredClone(homeJson));
  const seed = HomeSeed.parse(structuredClone(seedJson));
  const scene = buildHome(model);
  const ctx = createContext(model, furniture, defaultSettings);
  const items = seed.placements.map((p) => ({
    id: p.id,
    typeId: p.typeId,
    name: p.name,
    levelId: p.levelId,
    position: p.position,
    rotationY: p.rotationY,
    ...(p.mounting !== undefined && p.mounting !== 'floor' && { mounting: p.mounting }),
    ...(p.elevation !== undefined && p.elevation !== 0 && { elevation: p.elevation }),
    params: { ...p.params },
  }));
  const views = furnitureViews(ctx, items, scene, defaultVisibility(scene));
  const emitters = sceneEmitters(views, lampRooms(scene));

  it('every downlight emits, below its ceiling', () => {
    const downlights = items.filter((i) => i.typeId === 'fixture.downlight');
    expect(downlights.length).toBeGreaterThan(0);
    expect(emitters.map((e) => e.id).sort()).toEqual(downlights.map((d) => d.id).sort());
    for (const e of emitters) {
      const view = views.find((v) => v.id === e.id)!;
      expect(e.position[1]).toBeLessThan(view.position[1]);
      // Each is in a room of the souterrain. The kitchen is smaller than a downlight reaches,
      // so its lamps end at it; the corridor is long, and a lamp there may reach its own 6 m.
      expect(e.roomId).toMatch(/^souterrain-(kitchen|corridor)$/);
      expect(e.range).toBeGreaterThan(2);
      expect(e.range).toBeLessThanOrEqual(6);
      if (e.roomId === 'souterrain-kitchen') expect(e.range).toBeLessThan(5);
    }
  });

  it('a phone lights at most 6 of them', () => {
    const lit = assignPool(empty(POOL_SIZE.phone), emitters, [10, -2.6, -8], everywhere);
    expect(lit.filter((id) => id !== undefined).length).toBe(
      Math.min(POOL_SIZE.phone, emitters.length),
    );
  });
});
