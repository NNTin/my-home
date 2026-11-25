import {
  buildingFinishes,
  catalog,
  CUT_FINISH,
  DEFAULT_FINISHES,
  effectiveParams,
  interiorLevelId,
  outbuildingFinishes,
  outdoorAreaFinish,
  resolveFinish,
  roofOf,
  roomFinishes,
  SHELL_FINISHES,
  stairFinish,
  wallLength,
  type HomeModel,
  type Opening,
  type ParamValues,
  type ResolvedFinish,
  type RoomFinishes,
  type Slope,
  type Stair,
  type Wall,
} from '@my-home/shared';
import { gateParts, gateSpec } from '../catalog/gate/swing';
import { numberParam } from '../catalog/parts';
import { pieces } from '../catalog/registry';
import type { Part } from '../catalog/types';
import { pointInPolygon } from '../editor/geometry';
import { fenceLine, fenceSlats, fenceSpec, type FenceSlat } from './fence';
import {
  doorReveal,
  gableRoofTrim,
  wallSkirting,
  type DetailWall,
  type DoorRevealDescriptor,
  type RoofTrimDescriptor,
  type SkirtingDescriptor,
} from './shellDetail';
import { simplify, wallFaceShapes, wallUv, type WallEnd, type WallFaceShape } from './wallFaces';
import { EPS, rotationFor, toOutline, toVec2 } from './plan';

export { FENCE_BAY } from './fence';
export { rotationFor } from './plan';
export type { DoorRevealDescriptor, RoofTrimDescriptor, SkirtingDescriptor } from './shellDetail';
export { SHELL_DETAIL } from './shellDetail';
export type { WallFacePart } from './wallFaces';

/**
 * Pure model -> render descriptor builder. No three.js or GPU here, so it is unit-tested directly;
 * the R3F components in `scene/` only turn descriptors into meshes.
 *
 * World axes follow the model: x east, y up, z south. Plan points are `[x, z]`.
 */

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

/** A box: `size` is [length along its local x, height, depth]; rotated about y by `rotationY`. */
export interface Box {
  center: Vec3;
  size: Vec3;
  rotationY: number;
}

/**
 * A polygon in a local (x, y) plane, extruded through `depth` along local z (centred on the
 * plane), rotated about y by `rotationY` and moved to `center`. See `solidPoint`.
 */
export interface ProfileSolid {
  center: Vec3;
  rotationY: number;
  depth: number;
  outline: Vec2[];
}

/**
 * How a texture is laid on a surface (docs/design/realistic-render.md §5.4): a point of the world
 * and two unit directions. A vertex's texture coordinate, in metres, is its distance from `origin`
 * along `u` and along `v`.
 */
export interface UvFrame {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
}

/**
 * A solid stretch of a wall between and around its openings: a box, or under a pitched roof the
 * `outline`. The stretches are the wall as closed solids, which a section caps (§7.2); what is
 * drawn of a wall is its faces (`WallFace`).
 */
export interface WallSegment extends Box {
  id: string;
  wallId: string;
  levelId: string;
  apartmentId?: string;
  kind: Wall['kind'];
  /**
   * Set when the segment is trimmed by a pitched roof: this outline (local along-wall x and
   * height y, relative to `center`) extruded through the wall thickness instead of the box.
   */
  outline?: Vec2[];
}

/**
 * One flat face of a wall, as it is drawn (§8.1): a polygon in the wall's frame (`center` is the
 * wall's start at its floor; x runs along the wall, y up, z across it). A long face is one
 * polygon per room it borders, with the openings as holes, and takes that room's wall finish; a
 * face that borders no room is an outer face of the building and takes the facade finish (§5.5).
 * The top is a cut face (§7.2), the reveals take the finish of the long face they meet.
 */
export interface WallFace extends WallFaceShape {
  wallId: string;
  levelId: string;
  apartmentId?: string;
  center: Vec3;
  rotationY: number;
  /** Textures run along the wall from its start and up from its floor. */
  uv: UvFrame;
}

/** One sloped plane of a pitched roof. */
export interface RoofPlaneDescriptor extends ProfileSolid {
  id: string;
  levelId: string;
  finish: ResolvedFinish;
  /** Textures run along the eave from its start and up the slope, at true length. */
  uv: UvFrame;
}

/**
 * A use of a catalogue type in the model (an opening, a roof window, a gate): its type, name,
 * effective parameter values and the parts its piece module draws for them. Opening and roof
 * window parts are in the local frame of the descriptor's box; a gate's are in the plan.
 */
export interface PieceUse {
  typeId: string;
  name: string;
  values: ParamValues;
  parts: Part[];
}

export interface OpeningDescriptor extends Box, PieceUse {
  id: string;
  wallId: string;
  levelId: string;
  apartmentId?: string;
  type: Opening['type'];
}

/**
 * A plane falling linearly along a plan axis: `high` at coordinate `from`, `low` at `to` (and
 * clamped beyond them).
 */
export interface PlaneSlope {
  axis: 'x' | 'z';
  from: number;
  to: number;
  high: number;
  low: number;
}

/** Height of a sloped plane above the plan point `[x, z]`. */
export function slopeY(slope: PlaneSlope, [x, z]: Vec2): number {
  const at = slope.axis === 'x' ? x : z;
  const t = slope.to === slope.from ? 0 : (at - slope.from) / (slope.to - slope.from);
  return slope.high + (slope.low - slope.high) * Math.min(1, Math.max(0, t));
}

/**
 * The ground's height at a plan point: the highest terrain patch top over it (on its slope where it
 * has one), else `fallback`. Outdoor pieces stand on it.
 */
export function groundAt(
  terrain: readonly Pick<Prism, 'outline' | 'holes' | 'top' | 'slope'>[],
  point: Vec2,
  fallback: number,
): number {
  let best: number | undefined;
  for (const patch of terrain) {
    if (!pointInPolygon(point, patch.outline) || patch.holes.some((h) => pointInPolygon(point, h)))
      continue;
    const y = patch.slope ? slopeY(patch.slope, point) : patch.top;
    if (best === undefined || y > best) best = y;
  }
  return best ?? fallback;
}

/** Resolves a model slope against the bounding box of `outline`, offset vertically by `lift`. */
export function resolveSlope(
  outline: Vec2[],
  high: number,
  slope: Slope | undefined,
  lift = 0,
): PlaneSlope | undefined {
  if (!slope) return undefined;
  const axis = slope.towards.endsWith('x') ? 'x' : 'z';
  const values = outline.map(([x, z]) => (axis === 'x' ? x : z));
  const [min, max] = [Math.min(...values), Math.max(...values)];
  const [from, to] = slope.towards.startsWith('+') ? [min, max] : [max, min];
  return { axis, from, to, high: high + lift, low: slope.lowElevation.value + lift };
}

/**
 * A prism extruded vertically from `bottom` to `top`. With `slope` its top follows that plane
 * instead (`top` is then the high edge).
 */
export interface Prism {
  outline: Vec2[];
  holes: Vec2[][];
  bottom: number;
  top: number;
  slope?: PlaneSlope;
}

export interface SlabDescriptor extends Prism {
  id: string;
  levelId: string;
  kind: 'floor' | 'roof';
  finish: ResolvedFinish;
}

/**
 * A lowered ceiling: a solid from its underside up to just below the slab above. It is shown with
 * the level above it (`visibleScene`), so a cutaway still looks into the rooms from above.
 */
export interface CeilingDescriptor extends Prism {
  id: string;
  name: string;
  levelId: string;
  apartmentId?: string;
  /** The ceiling finish of the room it hangs in. */
  finish: ResolvedFinish;
}

/** A flat surface at height `y`, or on `slope` (`y` is then the high edge). */
export interface Surface {
  outline: Vec2[];
  holes?: Vec2[][];
  y: number;
  slope?: PlaneSlope;
}

export interface RoomFloorDescriptor extends Surface {
  id: string;
  roomId: string;
  name: string;
  levelId: string;
  apartmentId?: string;
  /** Where the room's name goes: the middle of its floor. */
  labelAt: Vec3;
  finish: ResolvedFinish;
}

/**
 * The ceiling of a room: a surface just under the slab above, with the room's ceiling finish.
 * Like a lowered ceiling it is shown with the level above it, so a cutaway looks into the room.
 */
export interface RoomCeilingDescriptor extends Surface {
  id: string;
  roomId: string;
  levelId: string;
  apartmentId?: string;
  finish: ResolvedFinish;
}

export interface TerrainDescriptor extends Prism {
  id: string;
  name: string;
}

export interface OutdoorAreaDescriptor extends Surface {
  id: string;
  name: string;
  kind: HomeModel['outdoorAreas'][number]['kind'];
  ownerApartmentId?: string;
  finish: ResolvedFinish;
}

/** A stair: one box per tread and landing, bottom to top. */
export interface StairDescriptor {
  id: string;
  name: string;
  levelId: string;
  toLevelId: string;
  apartmentId?: string;
  /** Which way it turns going up, seen from above. */
  turn: 'clockwise' | 'counter-clockwise' | 'straight';
  /** Height of one step. */
  rise: number;
  steps: (Box & { id: string; part: 'tread' | 'landing' })[];
  /** Plan rectangle the stair covers: the stairwell opening in the floor it leads up to. */
  well: Vec2[];
  finish: ResolvedFinish;
}

/**
 * A fence: posts, one panel per bay (stepped along sloping ground) and the slats that fill the
 * bays: the panels are the bays as boxes, drawn only as a wire mesh. A gate is also a use of its
 * catalogue type (`typeId`, `values`, `parts`), drawn from its parts.
 */
export interface FenceDescriptor extends Partial<Omit<PieceUse, 'name'>> {
  id: string;
  name: string;
  kind: NonNullable<HomeModel['fences']>[number]['kind'];
  posts: (Box & { id: string })[];
  panels: (Box & { id: string })[];
  /** The boards, laths or rails that fill the bays; a gate has none (its parts draw it). */
  slats: FenceSlat[];
}

/** An opening in an outbuilding wall. */
export interface OutbuildingOpeningDescriptor extends Box, PieceUse {
  id: string;
  type: Opening['type'];
}

/** A garage, shed or carport: wall boxes, their openings and a flat roof. */
export interface OutbuildingDescriptor {
  id: string;
  name: string;
  kind: NonNullable<HomeModel['outbuildings']>[number]['kind'];
  walls: (Box & { id: string })[];
  openings: OutbuildingOpeningDescriptor[];
  roof: Prism & { id: string };
  /** Of the walls, and of the flat roof. */
  finishes: { walls: ResolvedFinish; roof: ResolvedFinish };
}

/**
 * A window lying on a roof plane. `size` is [along the ridge, thickness, down the slope]; the
 * box is turned by `tilt` about its local x, then by `rotationY` about y (Euler order YXZ), so
 * its local +z runs down the slope.
 */
export interface RoofWindowDescriptor extends PieceUse {
  id: string;
  levelId: string;
  center: Vec3;
  size: Vec3;
  rotationY: number;
  tilt: number;
}

export interface LevelInfo {
  id: string;
  name: string;
  /** Position in the stack, 0 = lowest. */
  index: number;
  elevation: number;
  height: number;
}

export interface ApartmentInfo {
  id: string;
  name: string;
  levelIds: string[];
}

export interface HomeScene {
  levels: LevelInfo[];
  apartments: ApartmentInfo[];
  /** The walls as solids, and as the faces that are drawn. */
  walls: WallSegment[];
  wallFaces: WallFace[];
  /** Shell detail (§8.1): skirting boards, and the linings and thresholds of doors. */
  skirting: SkirtingDescriptor[];
  doorReveals: DoorRevealDescriptor[];
  openings: OpeningDescriptor[];
  slabs: SlabDescriptor[];
  ceilings: CeilingDescriptor[];
  roomFloors: RoomFloorDescriptor[];
  roomCeilings: RoomCeilingDescriptor[];
  terrain: TerrainDescriptor[];
  outdoorAreas: OutdoorAreaDescriptor[];
  /** Planes of a pitched roof; a flat roof is a slab of kind `roof` instead. */
  roofPlanes: RoofPlaneDescriptor[];
  /** The trim of a pitched roof: eaves boards, gutters, the ridge cap. */
  roofTrim: RoofTrimDescriptor[];
  roofWindows: RoofWindowDescriptor[];
  outbuildings: OutbuildingDescriptor[];
  stairs: StairDescriptor[];
  fences: FenceDescriptor[];
  bounds: { min: Vec3; max: Vec3 };
}

/** Room floors and outdoor surfaces float this far above their base to avoid z-fighting. */
export const SURFACE_OFFSET = 0.01;

/** How far in front of a wall face the room it borders is looked for. */
const FACE_PROBE = 0.05;
/** A stretch of a face shorter than this is not given a finish of its own. */
const FACE_MIN = 0.01;

/** Basic parameter overrides by use id (opening, roof window or gate id). */
export type PieceOverrides = ReadonlyMap<string, ParamValues>;

/** The piece module and effective values of the use `id` of `typeId`. */
function pieceUse(typeId: string, id: string, overrides: PieceOverrides | undefined) {
  const type = catalog.get(typeId);
  const piece = pieces.get(typeId);
  if (!type || !piece) throw new Error(`Unknown piece type "${typeId}" of ${id}`);
  return { piece, values: effectiveParams(type, overrides?.get(id)).values };
}

/** World position of the outline point `[x, y]` of a profile solid, at local depth `z`. */
export function solidPoint(solid: ProfileSolid, [x, y]: Vec2, z = 0): Vec3 {
  const c = Math.cos(solid.rotationY);
  const s = Math.sin(solid.rotationY);
  // Same rotation as three.js about +y: (x, z) -> (x cos + z sin, -x sin + z cos).
  const [cx, cy, cz] = solid.center;
  return [cx + x * c + z * s, cy + y, cz - x * s + z * c];
}

/** The eight world corners of a box, honouring its rotation about y. */
export function boxCorners(box: Box): Vec3[] {
  const [sx, sy, sz] = box.size;
  const solid = { center: box.center, rotationY: box.rotationY, depth: sz, outline: [] };
  return [-1, 1].flatMap((i) =>
    [-1, 1].flatMap((j) =>
      [-1, 1].map((k) => solidPoint(solid, [(i * sx) / 2, (j * sy) / 2], (k * sz) / 2)),
    ),
  );
}

/** A gable roof resolved against the footprint; "across" is the plan axis across the ridge. */
export interface Gable {
  levelId: string;
  ridgeAxis: 'x' | 'z';
  /** Footprint bounds along the ridge and across it. */
  along: Vec2;
  across: Vec2;
  /** Across coordinate of the ridge. */
  ridge: number;
  /** Height of the roof underside at the footprint edge, and its slope (rise per metre). */
  eaveY: number;
  slope: number;
  thickness: number;
  overhang: number;
}

export function gableOf(model: HomeModel, top: LevelInfo | undefined): Gable | undefined {
  const roof = roofOf(model.building);
  if (roof.type !== 'gable' || !top) return undefined;
  const xs = model.building.footprint.map((p) => p.x.value);
  const zs = model.building.footprint.map((p) => p.z.value);
  const range = (v: number[]): Vec2 => [Math.min(...v), Math.max(...v)];
  const [along, across] = roof.ridgeAxis === 'x' ? [range(xs), range(zs)] : [range(zs), range(xs)];
  return {
    levelId: top.id,
    ridgeAxis: roof.ridgeAxis,
    along,
    across,
    ridge: (across[0] + across[1]) / 2,
    eaveY: top.elevation + roof.kneeWallHeight.value,
    slope: Math.tan((roof.pitch.value * Math.PI) / 180),
    thickness: model.building.roofThickness.value,
    overhang: roof.overhang.value,
  };
}

/** Height of the roof underside above the plan coordinate `across` (beyond the eaves too). */
export const roofUnderside = (g: Gable, across: number) =>
  g.eaveY + ((g.across[1] - g.across[0]) / 2 - Math.abs(across - g.ridge)) * g.slope;

/** The two roof planes, each from the ridge down past the eaves by the overhang. */
export function gableRoofPlanes(
  g: Gable,
  finish: ResolvedFinish = resolveFinish(undefined, { finish: DEFAULT_FINISHES.roof }),
): RoofPlaneDescriptor[] {
  const half = (g.across[1] - g.across[0]) / 2;
  const reach = half + g.overhang;
  const ridgeY = g.eaveY + half * g.slope;
  const eaveY = g.eaveY - g.overhang * g.slope;
  // Vertical thickness of a slab that is `thickness` thick at right angles to its slope.
  const t = g.thickness * Math.hypot(1, g.slope);
  const alongMid = (g.along[0] + g.along[1]) / 2;
  const center: Vec3 = g.ridgeAxis === 'x' ? [alongMid, 0, g.ridge] : [g.ridge, 0, alongMid];
  // Local x runs across the ridge (towards +z or +x), local z along it.
  const rotationY = g.ridgeAxis === 'x' ? rotationFor(0, 1) : rotationFor(1, 0);
  const depth = g.along[1] - g.along[0] + 2 * g.overhang;
  return ([-1, 1] as const).map((side) => {
    const solid = { center, rotationY, depth, outline: [] };
    // The eave's start on the top face, and from there along the eave and up the slope.
    const origin = solidPoint(solid, [side * reach, eaveY + t], -depth / 2);
    const [ex, , ez] = solidPoint(solid, [side * reach, eaveY + t], depth / 2);
    const [rx, ry, rz] = solidPoint(solid, [0, ridgeY + t], -depth / 2);
    const up: Vec3 = [rx - origin[0], ry - origin[1], rz - origin[2]];
    const length = Math.hypot(...up);
    return {
      id: `roof:${side < 0 ? 'min' : 'max'}`,
      levelId: g.levelId,
      center,
      rotationY,
      depth,
      outline: [
        [0, ridgeY],
        [side * reach, eaveY],
        [side * reach, eaveY + t],
        [0, ridgeY + t],
      ],
      finish,
      uv: {
        origin,
        u: [(ex - origin[0]) / depth, 0, (ez - origin[2]) / depth],
        v: [up[0] / length, up[1] / length, up[2] / length],
      },
    };
  });
}

/**
 * Trims a wall span (`from`..`to` along the wall, `bottom`..`top` above its floor) to
 * `ceiling(t)`, a piecewise linear height whose kinks are at `kinks`. Returns `undefined` when the
 * span is entirely below the ceiling, `null` when entirely above, else the trimmed outline.
 */
export function clipSpan(
  span: Pick<Span, 'from' | 'to' | 'bottom' | 'top'>,
  ceiling: (t: number) => number,
  kinks: number[],
): Vec2[] | undefined | null {
  const { from, to, bottom, top } = span;
  const base = [from, ...kinks.filter((t) => t > from + EPS && t < to - EPS), to].sort(
    (a, b) => a - b,
  );
  // Clamping to [bottom, top] adds a kink wherever the ceiling crosses either of them.
  const ts: number[] = [];
  base.forEach((t, i) => {
    ts.push(t);
    const next = base[i + 1];
    if (next === undefined) return;
    for (const level of [bottom, top]) {
      const a = ceiling(t) - level;
      const b = ceiling(next) - level;
      if (a * b < -EPS * EPS) ts.push(t + ((next - t) * a) / (a - b));
    }
  });
  ts.sort((a, b) => a - b);
  if (ts.every((t) => ceiling(t) >= top - EPS)) return undefined;
  if (ts.every((t) => ceiling(t) <= bottom + EPS)) return null;
  const height = (t: number) => Math.min(top, Math.max(bottom, ceiling(t)));
  const points: Vec2[] = [
    [from, bottom],
    [to, bottom],
    ...ts.reverse().map((t): Vec2 => [t, height(t)]),
  ];
  return simplify(points);
}

interface Span {
  part: 'full' | 'below' | 'above';
  from: number;
  to: number;
  bottom: number;
  top: number;
}

/**
 * Splits a wall of `length` x `height` into solid spans around its openings (no CSG): full-height
 * pieces between openings, plus the parapet below and lintel above each opening.
 */
export function splitWall(
  length: number,
  height: number,
  openings: { offset: number; width: number; sill: number; height: number }[],
): Span[] {
  const spans: Span[] = [];
  let cursor = 0;
  for (const o of [...openings].sort((a, b) => a.offset - b.offset)) {
    const from = Math.max(o.offset, cursor);
    const to = Math.min(o.offset + o.width, length);
    if (from - cursor > EPS)
      spans.push({ part: 'full', from: cursor, to: from, bottom: 0, top: height });
    if (to - from > EPS) {
      if (o.sill > EPS)
        spans.push({ part: 'below', from, to, bottom: 0, top: Math.min(o.sill, height) });
      const lintel = o.sill + o.height;
      if (height - lintel > EPS)
        spans.push({ part: 'above', from, to, bottom: lintel, top: height });
    }
    cursor = Math.max(cursor, to);
  }
  if (length - cursor > EPS)
    spans.push({ part: 'full', from: cursor, to: length, bottom: 0, top: height });
  return spans;
}

export function buildHome(model: HomeModel, overrides?: PieceOverrides): HomeScene {
  const levels: LevelInfo[] = [...model.levels]
    .sort((a, b) => a.elevation.value - b.elevation.value)
    .map((l, index) => ({
      id: l.id,
      name: l.name,
      index,
      elevation: l.elevation.value,
      height: l.height.value,
    }));
  const levelById = new Map(model.levels.map((l) => [l.id, l]));
  const gable = gableOf(model, levels.at(-1));
  const elevationOf = (levelId: string) => levelById.get(levelId)?.elevation.value ?? 0;

  const walls: WallSegment[] = [];
  const wallFaces: WallFace[] = [];
  const skirting: SkirtingDescriptor[] = [];
  const doorReveals: DoorRevealDescriptor[] = [];
  const openings: OpeningDescriptor[] = [];
  const openingsByWall = new Map<string, Opening[]>();
  for (const o of model.openings)
    openingsByWall.set(o.wallId, [...(openingsByWall.get(o.wallId) ?? []), o]);

  // Finishes (§5.5): a room's own or the defaults; above the interior level the neutral shell.
  const exteriorFinishes = buildingFinishes(model.building);
  const interiorLevel = interiorLevelId(model);
  // The defaults of a level, for a face or a ceiling that belongs to none of its rooms.
  const interiorDefaults = roomFinishes(model, { levelId: interiorLevel ?? '' });
  const levelFinishes = (levelId: string): RoomFinishes =>
    levelId === interiorLevel ? interiorDefaults : SHELL_FINISHES;
  const rooms = model.rooms.map((r) => ({
    id: r.id,
    levelId: r.levelId,
    outline: toOutline(r.outline),
    finishes: roomFinishes(model, r),
  }));
  const roomAt = (levelId: string, point: Vec2) =>
    rooms.find((r) => r.levelId === levelId && pointInPolygon(point, r.outline));

  /** Whether a plan point lies in the body of another wall of the level than `own`. */
  const inWall = (own: Wall, [x, z]: Vec2) =>
    model.walls.some((w) => {
      if (w === own || w.levelId !== own.levelId) return false;
      const [ax, az] = toVec2(w.start);
      const [bx, bz] = toVec2(w.end);
      const l = Math.hypot(bx - ax, bz - az);
      const along = ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l;
      const across = ((x - ax) * (bz - az) - (z - az) * (bx - ax)) / l;
      return along > -EPS && along < l + EPS && Math.abs(across) < w.thickness.value / 2 + EPS;
    });

  // Which side of a wall opening is outdoors: windows put their board and curtain in the room.
  const plan = toOutline(model.building.footprint);
  for (const wall of model.walls) {
    const [sx, sz] = toVec2(wall.start);
    const [ex, ez] = toVec2(wall.end);
    const length = wallLength(wall);
    const dx = (ex - sx) / length;
    const dz = (ez - sz) / length;
    const rotationY = rotationFor(dx, dz);
    const base = elevationOf(wall.levelId);
    const thickness = wall.thickness.value;
    const at = (along: number, y: number): Vec3 => [sx + dx * along, y, sz + dz * along];
    const common = {
      wallId: wall.id,
      levelId: wall.levelId,
      ...(wall.apartmentId !== undefined && { apartmentId: wall.apartmentId }),
    };

    const wallOpenings = openingsByWall.get(wall.id) ?? [];
    const spans = splitWall(
      length,
      wall.height.value,
      wallOpenings.map((o) => ({
        offset: o.offset.value,
        width: o.width.value,
        sill: o.sill.value,
        height: o.height.value,
      })),
    );
    // Under a gable roof the attic's walls are trimmed to the roof underside, which turns a tall
    // gable-end wall into a gable and knee walls into a flush fit.
    const trim = gable?.levelId === wall.levelId ? roofCeiling(gable, wall, base) : undefined;

    // What each long face borders, along the wall: a room's outline can only begin or end where
    // one of its corners lies, so the face is probed between the corners of the level's rooms.
    const corners = rooms
      .filter((r) => r.levelId === wall.levelId)
      .flatMap((r) => r.outline.map(([x, z]) => (x - sx) * dx + (z - sz) * dz))
      .filter((t) => t > FACE_MIN && t < length - FACE_MIN)
      .sort((a, b) => a - b);
    const stops = [0, ...corners, length].filter((t, i, all) => i === 0 || t - all[i - 1]! > EPS);
    const runsOf = (side: 1 | -1) => {
      const reach = side * (thickness / 2 + FACE_PROBE);
      const runs: { from: number; to: number; roomId?: string; finish: ResolvedFinish }[] = [];
      for (let i = 0; i + 1 < stops.length; i++) {
        const [from, to] = [stops[i]!, stops[i + 1]!];
        const mid = (from + to) / 2;
        // The segment's local +z is (-dz, dx) on the plan.
        const probe: Vec2 = [sx + dx * mid - dz * reach, sz + dz * mid + dx * reach];
        const room = roomAt(wall.levelId, probe);
        const finish = room
          ? room.finishes.walls
          : wall.kind === 'exterior' && !pointInPolygon(probe, plan)
            ? exteriorFinishes.facade
            : levelFinishes(wall.levelId).walls;
        const last = runs.at(-1);
        if (last && last.roomId === room?.id && last.finish === finish) last.to = to;
        else runs.push({ from, to, ...(room && { roomId: room.id }), finish });
      }
      return runs;
    };
    const runs = { 1: runsOf(1), [-1]: runsOf(-1) } as Record<1 | -1, ReturnType<typeof runsOf>>;

    spans.forEach((s, i) => {
      const outline = trim && clipSpan(s, trim.ceiling, trim.kinks);
      if (outline === null) return;
      const mid = (s.from + s.to) / 2;
      const midY = (s.bottom + s.top) / 2;
      walls.push({
        ...common,
        id: `${wall.id}:${i}:${s.part}`,
        kind: wall.kind,
        center: at(mid, base + midY),
        size: [s.to - s.from, s.top - s.bottom, thickness],
        rotationY,
        ...(outline && { outline: outline.map(([t, y]): Vec2 => [t - mid, y - midY]) }),
      });
    });

    // What is drawn: the wall's faces. An end that looks into a room takes that room's finish,
    // unless it stands inside another wall.
    const coreFinish =
      wall.kind === 'exterior' ? exteriorFinishes.facade : levelFinishes(wall.levelId).walls;
    const endOf = (along: number): WallEnd => {
      const probe: Vec2 = [sx + dx * along, sz + dz * along];
      if (inWall(wall, probe)) return { covered: true };
      const room = roomAt(wall.levelId, probe);
      return room ? { roomId: room.id, finish: room.finishes.walls } : {};
    };
    const start: Vec3 = [sx, base, sz];
    const uv = wallUv(start, [dx, dz]);
    const cuts = wallOpenings.map((o) => ({
      id: o.id,
      from: o.offset.value,
      to: o.offset.value + o.width.value,
      bottom: o.sill.value,
      top: o.sill.value + o.height.value,
    }));
    const ends: [WallEnd, WallEnd] = [endOf(-FACE_PROBE), endOf(length + FACE_PROBE)];
    for (const face of wallFaceShapes({
      length,
      height: wall.height.value,
      thickness,
      cuts,
      chain: trim
        ? topEdge(length, wall.height.value, trim.ceiling, trim.kinks)
        : [
            [0, wall.height.value],
            [length, wall.height.value],
          ],
      runs,
      ends,
      finish: coreFinish,
      cutFinish: CUT_FINISH,
    })) {
      wallFaces.push({
        ...face,
        ...common,
        id: `${wall.id}/${face.id}`,
        center: start,
        rotationY,
        uv,
      });
    }

    // Shell detail (§8.1). Skirting and door linings are the inside of the level that is
    // modelled inside; a threshold lies in every doorway.
    const detail: DetailWall = {
      id: wall.id,
      levelId: wall.levelId,
      ...(wall.apartmentId !== undefined && { apartmentId: wall.apartmentId }),
      // The wall's local +z is (-dz, dx) on the plan.
      at: (along, y, across = 0) => [
        sx + dx * along - dz * across,
        y,
        sz + dz * along + dx * across,
      ],
      rotationY,
      base,
      length,
      thickness,
    };
    const inside = wall.levelId === interiorLevel;
    if (inside) skirting.push(...wallSkirting(detail, runs, ends, cuts, SURFACE_OFFSET));
    wallOpenings.forEach((o, i) => {
      if ((o.type !== 'door' && o.type !== 'french-door') || o.sill.value > EPS) return;
      const frame = pieceUse(o.typeId, o.id, overrides).values.frameColor;
      const lining = inside && wall.kind === 'interior';
      doorReveals.push(
        doorReveal(
          detail,
          cuts[i]!,
          SURFACE_OFFSET,
          lining ? { color: typeof frame === 'string' ? frame : '#ffffff' } : undefined,
        ),
      );
    });

    /** 1 when the opening's local +z, (-dz, dx) on the plan, leads out of the footprint. */
    const outsideOf = (along: number): 1 | -1 => {
      const [cx, cz] = [sx + dx * along, sz + dz * along];
      const reach = thickness / 2 + 0.1;
      return pointInPolygon([cx - dz * reach, cz + dx * reach], plan) ? -1 : 1;
    };
    const clearHeight = levelById.get(wall.levelId)?.height.value;
    for (const o of wallOpenings) {
      const width = o.width.value;
      const height = o.height.value;
      const { piece, values } = pieceUse(o.typeId, o.id, overrides);
      openings.push({
        ...common,
        id: o.id,
        type: o.type,
        typeId: o.typeId,
        name: o.name,
        values,
        parts: piece.parts(values, {
          width,
          height,
          wallDepth: thickness,
          sill: o.sill.value,
          outside: outsideOf(o.offset.value + width / 2),
          ...(clearHeight !== undefined && {
            headroom: Math.max(0, clearHeight - o.sill.value - height),
          }),
        }),
        center: at(o.offset.value + width / 2, base + o.sill.value + height / 2),
        size: [width, height, thickness],
        rotationY,
      });
    }
  }

  const stairs = (model.stairs ?? []).map((s) =>
    buildStair(s, elevationOf(s.levelId), elevationOf(s.toLevelId)),
  );
  /** Stairwell openings in the floor of a level. */
  const wellsOf = (levelId: string) =>
    stairs.filter((s) => s.toLevelId === levelId).map((s) => s.well);

  const footprint = toOutline(model.building.footprint);
  const slabs: SlabDescriptor[] = model.levels.map((l) => ({
    id: `${l.id}:floor`,
    levelId: l.id,
    kind: 'floor',
    outline: footprint,
    holes: wellsOf(l.id),
    bottom: l.elevation.value - l.slabThickness.value,
    top: l.elevation.value,
    // A slab is covered by floors and ceilings; where it shows (a stairwell, a cut) it is neutral.
    finish: SHELL_FINISHES.floor,
  }));
  const topLevel = levels.at(-1);
  const roofPlanes = gable ? gableRoofPlanes(gable, exteriorFinishes.roof) : [];
  if (topLevel && !gable) {
    const roofBottom = topLevel.elevation + topLevel.height;
    slabs.push({
      id: 'roof',
      levelId: topLevel.id,
      kind: 'roof',
      outline: footprint,
      holes: [],
      bottom: roofBottom,
      // Top-floor exterior walls usually end flush with the roof; lift it to avoid z-fighting.
      top: roofBottom + model.building.roofThickness.value + SURFACE_OFFSET,
      finish: exteriorFinishes.roof,
    });
  }

  const ceilings: CeilingDescriptor[] = (model.ceilings ?? []).flatMap((c) => {
    const level = levelById.get(c.levelId);
    if (!level) return [];
    const outline = toOutline(c.outline);
    return [
      {
        id: c.id,
        name: c.name,
        levelId: c.levelId,
        ...(c.apartmentId !== undefined && { apartmentId: c.apartmentId }),
        outline,
        holes: [],
        bottom: level.elevation.value + c.height.value,
        // Kept off the slab above and the wall tops, which no one sees from here.
        top: level.elevation.value + level.height.value - SURFACE_OFFSET,
        finish: (roomAt(c.levelId, centroid(outline))?.finishes ?? levelFinishes(c.levelId))
          .ceiling,
      },
    ];
  });

  const roomFloors: RoomFloorDescriptor[] = model.rooms.map((r, index) => {
    const outline = toOutline(r.outline);
    const y = elevationOf(r.levelId) + SURFACE_OFFSET;
    const [cx, cz] = centroid(outline);
    const holes = wellsOf(r.levelId).filter((well) => inside(centroid(well), outline));
    return {
      id: `${r.id}:floor`,
      roomId: r.id,
      name: r.name,
      levelId: r.levelId,
      ...(r.apartmentId !== undefined && { apartmentId: r.apartmentId }),
      outline,
      ...(holes.length > 0 && { holes }),
      y,
      labelAt: [cx, y, cz],
      finish: rooms[index]!.finishes.floor,
    };
  });

  // Under a pitched roof the top level has no flat ceiling: its rooms end at the roof's underside.
  const roomCeilings: RoomCeilingDescriptor[] = model.rooms.flatMap((r, index) => {
    const level = levelById.get(r.levelId);
    if (!level || gable?.levelId === r.levelId) return [];
    const outline = toOutline(r.outline);
    // A stair that leaves the level goes through its ceiling.
    const holes = stairs
      .filter((s) => s.levelId === r.levelId)
      .map((s) => s.well)
      .filter((well) => inside(centroid(well), outline));
    return [
      {
        id: `${r.id}:ceiling`,
        roomId: r.id,
        levelId: r.levelId,
        ...(r.apartmentId !== undefined && { apartmentId: r.apartmentId }),
        outline,
        ...(holes.length > 0 && { holes }),
        // Just under the slab above, and above the top of a lowered ceiling.
        y: level.elevation.value + level.height.value - SURFACE_OFFSET / 2,
        finish: rooms[index]!.finishes.ceiling,
      },
    ];
  });

  const terrain: TerrainDescriptor[] = model.terrain.patches.map((p) => {
    const outline = toOutline(p.outline);
    const slope = resolveSlope(outline, p.elevation.value, p.slope);
    return {
      id: p.id,
      name: p.name,
      outline,
      holes: (p.holes ?? []).map(toOutline),
      bottom: model.terrain.bottomElevation.value,
      top: p.elevation.value,
      ...(slope && { slope }),
    };
  });

  const outdoorAreas: OutdoorAreaDescriptor[] = model.outdoorAreas.map((a) => {
    const outline = toOutline(a.outline);
    const slope = resolveSlope(outline, a.elevation.value, a.slope, SURFACE_OFFSET);
    return {
      id: a.id,
      name: a.name,
      kind: a.kind,
      ...(a.ownerApartmentId !== undefined && { ownerApartmentId: a.ownerApartmentId }),
      outline,
      y: a.elevation.value + SURFACE_OFFSET,
      ...(slope && { slope }),
      finish: outdoorAreaFinish(a),
    };
  });

  const fences = (model.fences ?? []).map((f) => buildFence(f, overrides));
  const outbuildings = (model.outbuildings ?? []).map((b) => buildOutbuilding(b, overrides));
  const roof = roofOf(model.building);
  const roofWindows =
    gable && roof.type === 'gable' ? gableRoofWindows(gable, roof.windows ?? [], overrides) : [];

  return {
    levels,
    apartments: model.apartments.map((a) => ({ id: a.id, name: a.name, levelIds: a.levelIds })),
    walls,
    wallFaces,
    skirting,
    doorReveals,
    openings,
    slabs,
    ceilings,
    roomFloors,
    roomCeilings,
    terrain,
    outdoorAreas,
    roofPlanes,
    roofTrim:
      gable && roofPlanes[0] ? gableRoofTrim(gable, roofPlanes[0], exteriorFinishes.roof) : [],
    roofWindows,
    outbuildings,
    stairs,
    fences,
    bounds: boundsOf([
      ...outbuildings.flatMap((b) => b.walls.flatMap(boxCorners)),
      ...roofPlanes.flatMap((r) =>
        r.outline.flatMap((p) => [solidPoint(r, p, -r.depth / 2), solidPoint(r, p, r.depth / 2)]),
      ),
      ...terrain.flatMap((t) => t.outline.map(([x, z]) => [x, t.top, z] as Vec3)),
      ...slabs.flatMap((s) =>
        s.outline.flatMap(
          ([x, z]) =>
            [
              [x, s.bottom, z],
              [x, s.top, z],
            ] as Vec3[],
        ),
      ),
    ]),
  };
}

/**
 * The top edge of a wall under a pitched roof, from its start to its end: points along the wall
 * with their height above its floor, never above `height`. A height below the floor means the
 * roof is lower than the wall's foot there.
 */
export function topEdge(
  length: number,
  height: number,
  ceiling: (t: number) => number,
  kinks: number[],
): Vec2[] {
  const base = [0, ...kinks.filter((t) => t > EPS && t < length - EPS), length].sort(
    (a, b) => a - b,
  );
  // The edge also bends where the roof crosses the wall's top or its foot.
  const ts: number[] = [];
  base.forEach((t, i) => {
    ts.push(t);
    const next = base[i + 1];
    if (next === undefined) return;
    for (const level of [0, height]) {
      const a = ceiling(t) - level;
      const b = ceiling(next) - level;
      if (a * b < -EPS * EPS) ts.push(t + ((next - t) * a) / (a - b));
    }
  });
  return ts.sort((a, b) => a - b).map((t): Vec2 => [t, Math.min(height, ceiling(t))]);
}

/**
 * The roof underside as a height above the wall's floor along the wall (`t` from its start), and
 * where that height has kinks. Across a thick wall the highest point counts, so walls running
 * along the slope close against the roof on both faces.
 */
function roofCeiling(g: Gable, wall: Wall, base: number) {
  const length = wallLength(wall);
  const dx = (wall.end.x.value - wall.start.x.value) / length;
  const dz = (wall.end.z.value - wall.start.z.value) / length;
  const [u0, du, nu] =
    g.ridgeAxis === 'x' ? [wall.start.z.value, dz, dx] : [wall.start.x.value, dx, dz];
  const w = (wall.thickness.value / 2) * Math.abs(nu);
  const peak = roofUnderside(g, g.ridge);
  const ceiling = (t: number) => Math.min(peak, roofUnderside(g, u0 + du * t) + w * g.slope) - base;
  const kinks = Math.abs(du) < EPS ? [] : [-w, 0, w].map((o) => (g.ridge + o - u0) / du);
  return { ceiling, kinks };
}

/** Windows lying on the gable roof's planes, just above their top surface. */
export function gableRoofWindows(
  g: Gable,
  windows: NonNullable<Extract<HomeModel['building']['roof'], { type: 'gable' }>['windows']>,
  overrides?: PieceOverrides,
): RoofWindowDescriptor[] {
  const tilt = Math.atan(g.slope);
  const top = g.thickness * Math.hypot(1, g.slope);
  return windows.map((w) => {
    const width = w.width.value;
    const length = w.length.value;
    const { piece, values } = pieceUse(w.typeId, w.id, overrides);
    const thickness = numberParam(values, 'thickness');
    // Horizontal distance from the footprint edge to the window's centre.
    const inset = (w.fromEave.value + length / 2) * Math.cos(tilt);
    const across = w.side === 'max' ? g.across[1] - inset : g.across[0] + inset;
    const along = g.along[0] + w.offset.value + width / 2;
    const y = roofUnderside(g, across) + top + thickness / 2 / Math.cos(tilt);
    const quarter = Math.PI / 2;
    const rotationY =
      g.ridgeAxis === 'x'
        ? w.side === 'max'
          ? 0
          : Math.PI
        : w.side === 'max'
          ? quarter
          : -quarter;
    return {
      id: w.id,
      levelId: g.levelId,
      typeId: w.typeId,
      name: w.name,
      values,
      parts: piece.parts(values, { width, height: length, wallDepth: thickness }),
      center: g.ridgeAxis === 'x' ? [along, y, across] : [across, y, along],
      size: [width, thickness, length],
      rotationY,
      tilt,
    };
  });
}

/** Walls along every footprint edge (overlapping at the corners), openings and a flat roof. */
export function buildOutbuilding(
  b: NonNullable<HomeModel['outbuildings']>[number],
  overrides?: PieceOverrides,
): OutbuildingDescriptor {
  const floor = b.floorElevation.value;
  const height = b.height.value;
  const t = b.wallThickness.value;
  const points = toOutline(b.footprint);
  const walls: OutbuildingDescriptor['walls'] = [];
  const openings: OutbuildingOpeningDescriptor[] = [];
  points.forEach(([sx, sz], edge) => {
    const [ex, ez] = points[(edge + 1) % points.length]!;
    const length = Math.hypot(ex - sx, ez - sz);
    if (length < EPS || b.openEdges?.includes(edge)) return;
    const dx = (ex - sx) / length;
    const dz = (ez - sz) / length;
    const rotationY = rotationFor(dx, dz);
    // Each wall runs half a thickness past both corners so the corners close.
    const at = (along: number, y: number): Vec3 => [
      sx + dx * (along - t / 2),
      y,
      sz + dz * (along - t / 2),
    ];
    const edgeOpenings = (b.openings ?? []).filter((o) => o.edge === edge);
    const spans = splitWall(
      length + t,
      height,
      edgeOpenings.map((o) => ({
        offset: o.offset.value + t / 2,
        width: o.width.value,
        sill: o.sill.value,
        height: o.height.value,
      })),
    );
    spans.forEach((span, i) => {
      walls.push({
        id: `${b.id}:${edge}:${i}:${span.part}`,
        center: at((span.from + span.to) / 2, floor + (span.bottom + span.top) / 2),
        size: [span.to - span.from, span.top - span.bottom, t],
        rotationY,
      });
    });
    for (const o of edgeOpenings) {
      const { piece, values } = pieceUse(o.typeId, o.id, overrides);
      openings.push({
        id: o.id,
        type: o.type,
        typeId: o.typeId,
        name: o.name,
        values,
        parts: piece.parts(values, { width: o.width.value, height: o.height.value, wallDepth: t }),
        center: at(
          t / 2 + o.offset.value + o.width.value / 2,
          floor + o.sill.value + o.height.value / 2,
        ),
        size: [o.width.value, o.height.value, t],
        rotationY,
      });
    }
  });
  return {
    id: b.id,
    name: b.name,
    kind: b.kind,
    walls,
    openings,
    roof: {
      id: `${b.id}:roof`,
      outline: points,
      holes: [],
      bottom: floor + height - b.roofThickness.value,
      top: floor + height + SURFACE_OFFSET,
    },
    finishes: outbuildingFinishes(b),
  };
}

/** Area centroid of a simple polygon (the mean of its points when it has no area). */
export function centroid(outline: Vec2[]): Vec2 {
  let [area, x, z] = [0, 0, 0];
  outline.forEach(([ax, az], i) => {
    const [bx, bz] = outline[(i + 1) % outline.length]!;
    const cross = ax * bz - bx * az;
    area += cross;
    x += (ax + bx) * cross;
    z += (az + bz) * cross;
  });
  if (Math.abs(area) < EPS) {
    const n = Math.max(outline.length, 1);
    return [
      outline.reduce((sum, p) => sum + p[0], 0) / n,
      outline.reduce((sum, p) => sum + p[1], 0) / n,
    ];
  }
  return [x / (3 * area), z / (3 * area)];
}

/** Whether a plan point lies inside a simple polygon. */
function inside([x, z]: Vec2, outline: Vec2[]): boolean {
  let result = false;
  outline.forEach(([ax, az], i) => {
    const [bx, bz] = outline[(i + 1) % outline.length]!;
    if (az > z !== bz > z && x < ax + ((z - az) / (bz - az)) * (bx - ax)) result = !result;
  });
  return result;
}

/** Steps are at most this high; the builder adds steps until they are. */
export const MAX_RISER = 0.19;

/**
 * Treads and landings of a stair climbing from `from` to `to` along its walking line. Every
 * turning point gets a square landing; the remaining steps are shared out over the flights by
 * their length. The last riser arrives on the upper floor, so there is no tread at `to`.
 */
export function buildStair(stair: Stair, from: number, to: number): StairDescriptor {
  const width = stair.width.value;
  const points = toOutline(stair.path);
  const flights = points.slice(0, -1).map(([sx, sz], i) => {
    const [ex, ez] = points[i + 1]!;
    const length = Math.hypot(ex - sx, ez - sz);
    const dir: Vec2 = [(ex - sx) / length, (ez - sz) / length];
    // A landing takes half a width from the flight on either side of it.
    const start = i > 0 ? width / 2 : 0;
    const end = length - (i < points.length - 2 ? width / 2 : 0);
    return {
      origin: [sx, sz] as Vec2,
      dir,
      start,
      run: Math.max(end - start, 0),
      corner: [ex, ez] as Vec2,
    };
  });
  const landings = flights.length - 1;
  const totalRun = flights.reduce((sum, f) => sum + f.run, 0);
  const wanted = Math.ceil((to - from) / MAX_RISER - EPS) - 1 - landings;
  // Largest-remainder rounding, at least one tread per flight: the sum never falls short of
  // `wanted`, so no riser exceeds MAX_RISER.
  const shares = flights.map((f) => (wanted * f.run) / Math.max(totalRun, EPS));
  const treads = shares.map((share) => Math.max(1, Math.floor(share + EPS)));
  const byRemainder = shares
    .map((share, i) => ({ i, remainder: share - Math.floor(share + EPS) }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (let k = 0; treads.reduce((sum, n) => sum + n, 0) < wanted; k++) {
    treads[byRemainder[k % byRemainder.length]!.i]!++;
  }
  const rise = (to - from) / (treads.reduce((sum, n) => sum + n, 0) + landings + 1);

  const steps: StairDescriptor['steps'] = [];
  const add = (part: 'tread' | 'landing', [x, z]: Vec2, dir: Vec2, depth: number) => {
    const top = from + rise * (steps.length + 1);
    // Two risers thick, so each step closes the gap down to the one below.
    const thickness = Math.min(2 * rise, top - from);
    steps.push({
      id: `${stair.id}:${steps.length}:${part}`,
      part,
      center: [x, top - thickness / 2, z],
      size: [depth, thickness, width],
      rotationY: rotationFor(dir[0], dir[1]),
    });
  };
  flights.forEach((f, i) => {
    const going = f.run / treads[i]!;
    for (let j = 0; j < treads[i]!; j++) {
      const along = f.start + (j + 0.5) * going;
      add('tread', [f.origin[0] + f.dir[0] * along, f.origin[1] + f.dir[1] * along], f.dir, going);
    }
    if (i < landings) add('landing', f.corner, f.dir, width);
  });

  // On the plan (x east, z south) a left turn, counter-clockwise from above, has a negative cross.
  const cross = flights
    .slice(1)
    .reduce((sum, f, i) => sum + flights[i]!.dir[0] * f.dir[1] - flights[i]!.dir[1] * f.dir[0], 0);
  const { min, max } = boundsOf(steps.flatMap(boxCorners));
  return {
    id: stair.id,
    name: stair.name,
    levelId: stair.levelId,
    toLevelId: stair.toLevelId,
    ...(stair.apartmentId !== undefined && { apartmentId: stair.apartmentId }),
    turn: Math.abs(cross) < EPS ? 'straight' : cross < 0 ? 'counter-clockwise' : 'clockwise',
    rise,
    steps,
    finish: stairFinish(stair),
    well: [
      [min[0], min[2]],
      [max[0], min[2]],
      [max[0], max[2]],
      [min[0], max[2]],
    ],
  };
}

/**
 * Posts and panels along a fence line (see `fenceLine`). A gate is built with the sizes of its
 * type's effective parameters and carries the parts its piece draws; other fences use the
 * per-kind constants.
 */
export function buildFence(
  fence: NonNullable<HomeModel['fences']>[number],
  overrides?: PieceOverrides,
): FenceDescriptor {
  const points = toOutline(fence.path);
  const start = fence.elevation.value;
  const end = fence.endElevation?.value ?? start;
  const common = { id: fence.id, name: fence.name, kind: fence.kind };
  if (fence.kind !== 'gate') {
    const line = fenceLine(fence.id, points, fence.height.value, start, end, fenceSpec(fence.kind));
    return { ...common, ...line, slats: fenceSlats(fence.kind, line.panels) };
  }
  if (!fence.typeId) throw new Error(`Gate ${fence.id} has no typeId`);
  const { values } = pieceUse(fence.typeId, fence.id, overrides);
  const line = fenceLine(fence.id, points, fence.height.value, start, end, gateSpec(values));
  return {
    ...common,
    ...line,
    slats: [],
    typeId: fence.typeId,
    values,
    parts: gateParts(values, line),
  };
}

function boundsOf(points: Vec3[]) {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, p[i]!);
      max[i] = Math.max(max[i]!, p[i]!);
    }
  }
  return points.length ? { min, max } : { min: [0, 0, 0] as Vec3, max: [0, 0, 0] as Vec3 };
}
