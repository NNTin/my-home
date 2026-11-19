import { ceilingHeightAt, type HomeModel } from '../home-model';
import { furnitureSize } from './fit';
import { formatCm } from './format';
import type { ParamValues } from './params';
import { isOutdoorKind, mountingOf, type CatalogType, type Mounting } from './types';

/**
 * How a placement hangs in its room (#63): on the floor, on a wall (its back against the wall's
 * face) or under the ceiling. A placement stores its `mounting` and its `elevation` (the height of
 * its bottom above the level's floor); a ceiling piece has no elevation of its own: it hangs at the
 * ceiling over it (`ceilingHeightAt`: a lowered ceiling or a box where there is one).
 */

/** Highest elevation a placement may have, in metres (a sanity limit, not a fit check). */
export const MAX_ELEVATION = 10;

/** How far the back of a wall piece may be from a wall's face and still hang on it (3 cm). */
export const WALL_CONTACT_TOLERANCE = 0.03;

/** Tolerance for "reaches above the ceiling" (1 mm). */
const EPS = 1e-3;

/**
 * The mountings a type's placements may have: a ceiling piece only hangs under a ceiling; every
 * other piece stands on the floor or hangs on a wall (the type's own mounting first).
 */
export function mountingsFor(type: Pick<CatalogType, 'mounting'>): Mounting[] {
  const own = mountingOf(type);
  if (own === 'ceiling') return ['ceiling'];
  return own === 'wall' ? ['wall', 'floor'] : ['floor', 'wall'];
}

/** The elevation a new placement gets: the type's (0 when it has none; always 0 under a ceiling). */
export const defaultElevation = (
  type: Pick<CatalogType, 'elevation'>,
  mounting: Mounting,
): number => (mounting === 'ceiling' ? 0 : (type.elevation ?? 0));

/** Why a mounting or an elevation is not valid for the type (undefined when it is). */
export function mountingIssue(
  type: Pick<CatalogType, 'mounting' | 'name'>,
  mounting: Mounting,
  elevation: number,
): string | undefined {
  if (!mountingsFor(type).includes(mounting)) {
    return `A ${type.name.toLowerCase()} cannot be mounted ${mountingText[mounting]}`;
  }
  if (mounting === 'ceiling' && elevation !== 0) {
    return 'A piece under the ceiling has no elevation: it hangs at the ceiling';
  }
  return undefined;
}

const mountingText: Record<Mounting, string> = {
  floor: 'on the floor',
  wall: 'on a wall',
  ceiling: 'under the ceiling',
};

export interface PlacedAt {
  levelId: string;
  x: number;
  z: number;
  rotationY: number;
}

/**
 * The height of a placement's bottom above its level's floor (its frame's origin): the elevation,
 * or for a ceiling piece the ceiling over it (undefined on an unknown level).
 */
export function mountHeight(
  model: Pick<HomeModel, 'levels' | 'ceilings'>,
  at: Pick<PlacedAt, 'levelId' | 'x' | 'z'>,
  mounting: Mounting,
  elevation: number,
): number | undefined {
  if (mounting !== 'ceiling') return elevation;
  return ceilingHeightAt(model, at.levelId, at.x, at.z);
}

/**
 * The wall the back of a piece hangs on: a wall of its level whose face (half the thickness from
 * its centre line) is within `WALL_CONTACT_TOLERANCE` of the middle of the piece's back (local
 * -z side, `depth` deep), parallel to the back (within 12°), and alongside it. The rotation is
 * three.js `rotation.y`, as in `furnitureFitIssues`.
 */
export function wallBehind(
  model: Pick<HomeModel, 'walls'>,
  at: PlacedAt,
  depth: number,
): HomeModel['walls'][number] | undefined {
  const [c, s] = [Math.cos(at.rotationY), Math.sin(at.rotationY)];
  // Local (0, -depth / 2) and the local x axis in plan coordinates.
  const back = [at.x - (depth / 2) * s, at.z - (depth / 2) * c] as const;
  const across = [c, -s] as const;
  const maxSin = Math.sin((12 * Math.PI) / 180);
  return model.walls.find((w) => {
    if (w.levelId !== at.levelId) return false;
    const [ax, az] = [w.start.x.value, w.start.z.value];
    const [dx, dz] = [w.end.x.value - ax, w.end.z.value - az];
    const length = Math.hypot(dx, dz);
    if (length < 1e-9) return false;
    const [ux, uz] = [dx / length, dz / length];
    const along = (back[0] - ax) * ux + (back[1] - az) * uz;
    if (along < -WALL_CONTACT_TOLERANCE || along > length + WALL_CONTACT_TOLERANCE) return false;
    const off = (x: number, z: number) => Math.abs((x - ax) * -uz + (z - az) * ux);
    const gap = off(back[0], back[1]) - w.thickness.value / 2;
    if (Math.abs(gap) > WALL_CONTACT_TOLERANCE) return false;
    // Parallel, and the piece stands in front of the face, not inside the wall.
    if (Math.abs(across[0] * -uz + across[1] * ux) > maxSin) return false;
    return off(at.x, at.z) > off(back[0], back[1]);
  });
}

/**
 * Why a placement does not fit in height, as sentences (empty when it fits, or on an unknown
 * level): a piece on the floor or a wall must not reach above the ceiling over its position.
 */
export function heightFitIssues(
  model: Pick<HomeModel, 'levels' | 'ceilings'>,
  type: Pick<CatalogType, 'name' | 'kind'>,
  values: ParamValues,
  at: Pick<PlacedAt, 'levelId' | 'x' | 'z'>,
  mounting: Mounting,
  elevation: number,
): string[] {
  // Outdoor pieces have the sky over them, not their level's ceiling.
  if (mounting === 'ceiling' || isOutdoorKind(type)) return [];
  const ceiling = ceilingHeightAt(model, at.levelId, at.x, at.z);
  if (ceiling === undefined) return [];
  const { height } = furnitureSize(values);
  if (elevation + height <= ceiling + EPS) return [];
  return [
    `The ${type.name.toLowerCase()} (${formatCm(height)} high, ${formatCm(elevation)} above the floor) reaches above the ceiling at ${formatCm(ceiling)}`,
  ];
}

/**
 * Why a placement's mounting no longer holds in the model (empty when it does), e.g. after a git
 * change: a wall piece whose wall is gone or moved, a ceiling piece outside every room.
 */
export function mountIssues(
  model: Pick<HomeModel, 'walls' | 'rooms'>,
  values: ParamValues,
  at: PlacedAt,
  mounting: Mounting,
  roomId: string | null,
): string[] {
  if (mounting === 'wall') {
    const { depth } = furnitureSize(values);
    return wallBehind(model, at, depth) ? [] : ['hangs on no wall (its wall is gone or moved)'];
  }
  if (mounting === 'ceiling') {
    const levelHasRooms = model.rooms.some((r) => r.levelId === at.levelId);
    return levelHasRooms && roomId === null ? ['no ceiling over it (outside every room)'] : [];
  }
  return [];
}
