import { wallLength, type HomeModel } from '@my-home/shared';
import type { Vec2 } from '../builder/buildHome';
import { distanceToSegment } from '../editor/geometry';

/** Something in the model the owner can point the phone at to calibrate the compass. */
export interface CalibrationTarget {
  id: string;
  /** "Door: corridor bed room". */
  label: string;
  /** The middle of the opening on the plan. */
  x: number;
  z: number;
  /** Metres from the figure. */
  distance: number;
}

const KIND: Record<string, string> = {
  door: 'Door',
  window: 'Window',
  'french-door': 'French door',
  'garage-door': 'Garage door',
};

/** An opening's id reads `<type>-<apartment>-<rooms…>`; the rooms are what tells them apart. */
function labelOf(type: string, id: string, apartments: string[]): string {
  let rest = id;
  for (const prefix of [`${type}-`, 'door-', 'window-']) {
    if (rest.startsWith(prefix)) {
      rest = rest.slice(prefix.length);
      break;
    }
  }
  for (const apartment of apartments) {
    if (rest.startsWith(`${apartment}-`)) rest = rest.slice(apartment.length + 1);
  }
  return `${KIND[type] ?? type}: ${rest.replaceAll('-', ' ')}`;
}

/** Openings nearer than this are too close to aim at reliably. */
const MIN_DISTANCE = 0.8;
/** Without a room (outdoors, or a level that is one open space), openings within this range. */
const OPEN_RANGE = 8;

/**
 * The doors and windows around the figure, nearest first: those in the walls of the room it is
 * in (`roomOutline`), or within a few metres when it is in no room.
 */
export function calibrationTargets(
  model: Pick<HomeModel, 'walls' | 'openings' | 'apartments'>,
  levelId: string | undefined,
  position: Vec2,
  roomOutline?: Vec2[],
): CalibrationTarget[] {
  // Apartment ids are `apt-<name>`; opening ids carry just the name.
  const apartments = model.apartments.map((a) => a.id.replace(/^apt-/, ''));
  const walls = new Map(model.walls.map((w) => [w.id, w]));
  const targets: CalibrationTarget[] = [];
  for (const opening of model.openings) {
    const wall = walls.get(opening.wallId);
    if (!wall || wall.levelId !== levelId) continue;
    const length = wallLength(wall);
    const along = (opening.offset.value + opening.width.value / 2) / length;
    const x = wall.start.x.value + (wall.end.x.value - wall.start.x.value) * along;
    const z = wall.start.z.value + (wall.end.z.value - wall.start.z.value) * along;
    const distance = Math.hypot(x - position[0], z - position[1]);
    if (distance < MIN_DISTANCE) continue;
    const inRoom = roomOutline
      ? roomOutline.some(
          (a, i) =>
            distanceToSegment([x, z], a, roomOutline[(i + 1) % roomOutline.length]!) <=
            wall.thickness.value / 2 + 0.1,
        )
      : distance <= OPEN_RANGE;
    if (inRoom) {
      targets.push({
        id: opening.id,
        label: labelOf(opening.type, opening.id, apartments),
        x,
        z,
        distance,
      });
    }
  }
  return targets.sort((a, b) => a.distance - b.distance);
}
