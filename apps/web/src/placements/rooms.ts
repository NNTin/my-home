import type { HomeScene, OpeningDescriptor, RoomFloorDescriptor } from '../builder/buildHome';
import type { Vec3 } from '../geom/types';
import { visibleScene, type Visibility } from '../builder/visibility';
import { pointInPolygon } from '../geom/geometry';

/** How far above or below a room's floor a click on it may land (its finish, a threshold). */
const FLOOR_SLACK = 0.25;
/** How far either side of an opening's middle a room is looked for: past any wall's half thickness. */
const SIDE_PROBE = 0.35;

/**
 * The room whose floor a point lies on (HUD v2 #201): of the rooms shown, the one whose outline holds it at the
 * height of its floor; none on a wall, outdoors or between levels.
 */
export function roomFloorAt(
  scene: HomeScene,
  v: Visibility,
  point: Vec3,
): RoomFloorDescriptor | undefined {
  const [x, y, z] = point;
  return visibleScene(scene, v)
    .roomFloors.filter((r) => Math.abs(r.y - y) <= FLOOR_SLACK && pointInPolygon([x, z], r.outline))
    .sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y))[0];
}

/** What "Focus room" frames: the room's middle, and the sphere around its floor. */
export function roomFocus(room: RoomFloorDescriptor): { center: Vec3; radius: number } {
  const xs = room.outline.map((p) => p[0]);
  const zs = room.outline.map((p) => p[1]);
  const radius =
    Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2;
  return {
    center: [room.labelAt[0], room.y + 1.2, room.labelAt[2]],
    radius: Math.max(radius, 1.5),
  };
}

/**
 * The spaces an opening links (#201: "linked spaces when the model supplies them"): the room on each side of its
 * wall on its level, or "outside". Empty when neither side is a room the model knows.
 */
export function openingSides(scene: HomeScene, opening: OpeningDescriptor): string[] {
  const floors = scene.roomFloors.filter((r) => r.levelId === opening.levelId);
  const [cx, , cz] = opening.center;
  // The opening's local z is its wall's normal.
  const [nx, nz] = [Math.sin(opening.rotationY), Math.cos(opening.rotationY)];
  const sides = [1, -1].map((s) => {
    const p: [number, number] = [cx + nx * SIDE_PROBE * s, cz + nz * SIDE_PROBE * s];
    return floors.find((r) => pointInPolygon(p, r.outline))?.name;
  });
  if (sides.every((s) => s === undefined)) return [];
  return sides.map((s) => s ?? 'outside');
}
