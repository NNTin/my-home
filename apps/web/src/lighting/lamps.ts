import type { HomeScene, Vec2, Vec3 } from '../builder/buildHome';
import type { PieceEmitter } from '../catalog/types';

/**
 * Fixtures that emit light (docs/design/realistic-render.md §6.4), as plain data. The scene holds
 * a fixed pool of point lights per device, created once; each frame the pool is assigned to the
 * emitters nearest the view's focus by moving lights, never by adding or removing them, so the
 * number of lights the shaders see never changes (§4.5). Nothing here knows a tier: fast and
 * beautiful frames light the same emitters.
 */

/** Point lights in the pool: a phone's and a desktop's. */
export const POOL_SIZE = { phone: 6, desktop: 12 } as const;
/** How many of them cast shadows: the first ones of the pool. A phone never draws a lamp shadow. */
export const SHADOW_LAMPS = { phone: 0, desktop: 4 } as const;

export const poolSize = (phone: boolean): number => (phone ? POOL_SIZE.phone : POOL_SIZE.desktop);
export const shadowLamps = (phone: boolean): number =>
  phone ? SHADOW_LAMPS.phone : SHADOW_LAMPS.desktop;

/** A room as the lamps need it: where it is and how high. */
export interface LampRoom {
  id: string;
  levelId: string;
  outline: Vec2[];
  floor: number;
  ceiling: number;
}

/** The rooms of a scene, each from its floor up to its level's height. */
export function lampRooms(scene: Pick<HomeScene, 'roomFloors' | 'levels'>): LampRoom[] {
  return scene.roomFloors.flatMap((f) => {
    const level = scene.levels.find((l) => l.id === f.levelId);
    if (!level) return [];
    return [
      {
        id: f.roomId,
        levelId: f.levelId,
        outline: f.outline,
        floor: level.elevation,
        ceiling: level.elevation + level.height,
      },
    ];
  });
}

function inside(outline: Vec2[], x: number, z: number): boolean {
  let within = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, zi] = outline[i]!;
    const [xj, zj] = outline[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) within = !within;
  }
  return within;
}

/** The room a point of the world is in, if any. */
export const roomAt = (rooms: readonly LampRoom[], [x, y, z]: Vec3): LampRoom | undefined =>
  rooms.find((r) => y >= r.floor && y <= r.ceiling && inside(r.outline, x, z));

/** An emitter in the world. */
export interface Emitter {
  /** The placement's id, with the emitter's index when a piece has several. */
  id: string;
  position: Vec3;
  color: string;
  /** Candela. */
  intensity: number;
  /** Metres; already ended at the bounds of its room. */
  range: number;
  roomId?: string;
}

/**
 * An emitter's range: what its type declares, ended at the bounds of its room, which is the
 * distance to the room's farthest corner. A lamp so lights every corner of its room and nothing
 * beyond that distance, shadowed or not.
 */
export function roomRange(position: Vec3, range: number, room: LampRoom | undefined): number {
  if (!room) return range;
  const [x, y, z] = position;
  let farthest = 0;
  for (const [cx, cz] of room.outline)
    for (const cy of [room.floor, room.ceiling])
      farthest = Math.max(farthest, Math.hypot(cx - x, cy - y, cz - z));
  return Math.min(range, farthest);
}

/** What the scene draws of an item that may emit: `FurnitureView` has these. */
export interface EmitterSource {
  id: string;
  position: Vec3;
  rotationY: number;
  emitters?: readonly PieceEmitter[];
  roomId?: string;
}

/** The emitters of the items that are drawn, in the world, in the items' order. */
export function sceneEmitters(
  items: readonly EmitterSource[],
  rooms: readonly LampRoom[],
): Emitter[] {
  return items.flatMap((item) =>
    (item.emitters ?? []).map((e, index): Emitter => {
      const cos = Math.cos(item.rotationY);
      const sin = Math.sin(item.rotationY);
      const [x, y, z] = e.position;
      const position: Vec3 = [
        item.position[0] + x * cos + z * sin,
        item.position[1] + y,
        item.position[2] - x * sin + z * cos,
      ];
      // The room the item is placed in, or else the one its light is in.
      const room = rooms.find((r) => r.id === item.roomId) ?? roomAt(rooms, position);
      return {
        id: index === 0 ? item.id : `${item.id}#${index}`,
        position,
        color: e.color,
        intensity: e.intensity,
        range: roomRange(position, e.range, room),
        ...(room && { roomId: room.id }),
      };
    }),
  );
}

const distance2 = (a: Vec3, b: Vec3) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** The emitters by their distance from `focus`, the nearest first; the id breaks a tie. */
export function nearest(emitters: readonly Emitter[], focus: Vec3): Emitter[] {
  return [...emitters].sort(
    (a, b) => distance2(a.position, focus) - distance2(b.position, focus) || (a.id < b.id ? -1 : 1),
  );
}

/**
 * The pool's next assignment: per pool light, the id of the emitter it lights, or undefined (its
 * intensity is then 0).
 *
 * - The pool wants the emitters nearest `focus`, as many as it has lights.
 * - **Reassignment is hidden.** A light leaves its emitter only when that emitter is gone, or when
 *   it is no longer wanted and `inSight` says its room is not seen. A lit lamp in view never
 *   jumps; a pool that is full of lamps in view stays as it is.
 * - A wanted emitter without a light takes a free one, the nearest emitter the first free light.
 *   The first lights of the pool are the ones that cast shadows on a desktop, so the nearest
 *   emitters get them.
 */
export function assignPool(
  previous: readonly (string | undefined)[],
  emitters: readonly Emitter[],
  focus: Vec3,
  inSight: (emitter: Emitter) => boolean,
): (string | undefined)[] {
  const byId = new Map(emitters.map((e) => [e.id, e]));
  const wanted = nearest(emitters, focus).slice(0, previous.length);
  const wantedIds = new Set(wanted.map((e) => e.id));
  const next = previous.map((id) => {
    const emitter = id === undefined ? undefined : byId.get(id);
    if (!emitter) return undefined;
    return wantedIds.has(emitter.id) || inSight(emitter) ? emitter.id : undefined;
  });
  const held = new Set(next);
  for (const emitter of wanted) {
    if (held.has(emitter.id)) continue;
    const free = next.indexOf(undefined);
    if (free < 0) break;
    next[free] = emitter.id;
  }
  return next;
}
