import {
  wallLength,
  type HomeModel,
  type Opening,
  type Point,
  type Polygon,
  type Wall,
} from '@my-home/shared';

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

export interface WallSegment extends Box {
  id: string;
  wallId: string;
  levelId: string;
  apartmentId?: string;
  kind: Wall['kind'];
}

export interface OpeningDescriptor extends Box {
  id: string;
  wallId: string;
  levelId: string;
  apartmentId?: string;
  type: Opening['type'];
}

/** A prism extruded vertically from `bottom` to `top`. */
export interface Prism {
  outline: Vec2[];
  holes: Vec2[][];
  bottom: number;
  top: number;
}

export interface SlabDescriptor extends Prism {
  id: string;
  levelId: string;
  kind: 'floor' | 'roof';
}

/** A flat surface at height `y`. */
export interface Surface {
  outline: Vec2[];
  y: number;
}

export interface RoomFloorDescriptor extends Surface {
  id: string;
  roomId: string;
  name: string;
  levelId: string;
  apartmentId?: string;
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
  walls: WallSegment[];
  openings: OpeningDescriptor[];
  slabs: SlabDescriptor[];
  roomFloors: RoomFloorDescriptor[];
  terrain: TerrainDescriptor[];
  outdoorAreas: OutdoorAreaDescriptor[];
  bounds: { min: Vec3; max: Vec3 };
}

/** Room floors and outdoor surfaces float this far above their base to avoid z-fighting. */
export const SURFACE_OFFSET = 0.01;
const EPS = 1e-6;

const toVec2 = (p: Point): Vec2 => [p.x.value, p.z.value];
const toOutline = (polygon: Polygon): Vec2[] => polygon.map(toVec2);

/** Rotation about +y that maps the local +x axis onto the plan direction (dx, dz). */
export const rotationFor = (dx: number, dz: number) => Math.atan2(-dz, dx);

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

export function buildHome(model: HomeModel): HomeScene {
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
  const elevationOf = (levelId: string) => levelById.get(levelId)?.elevation.value ?? 0;

  const walls: WallSegment[] = [];
  const openings: OpeningDescriptor[] = [];
  const openingsByWall = new Map<string, Opening[]>();
  for (const o of model.openings)
    openingsByWall.set(o.wallId, [...(openingsByWall.get(o.wallId) ?? []), o]);

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
    spans.forEach((s, i) =>
      walls.push({
        ...common,
        id: `${wall.id}:${i}:${s.part}`,
        kind: wall.kind,
        center: at((s.from + s.to) / 2, base + (s.bottom + s.top) / 2),
        size: [s.to - s.from, s.top - s.bottom, thickness],
        rotationY,
      }),
    );

    for (const o of wallOpenings) {
      const width = o.width.value;
      const height = o.height.value;
      openings.push({
        ...common,
        id: o.id,
        type: o.type,
        center: at(o.offset.value + width / 2, base + o.sill.value + height / 2),
        size: [width, height, thickness],
        rotationY,
      });
    }
  }

  const footprint = toOutline(model.building.footprint);
  const slabs: SlabDescriptor[] = model.levels.map((l) => ({
    id: `${l.id}:floor`,
    levelId: l.id,
    kind: 'floor',
    outline: footprint,
    holes: [],
    bottom: l.elevation.value - l.slabThickness.value,
    top: l.elevation.value,
  }));
  const topLevel = levels.at(-1);
  if (topLevel) {
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
    });
  }

  const roomFloors: RoomFloorDescriptor[] = model.rooms.map((r) => ({
    id: `${r.id}:floor`,
    roomId: r.id,
    name: r.name,
    levelId: r.levelId,
    ...(r.apartmentId !== undefined && { apartmentId: r.apartmentId }),
    outline: toOutline(r.outline),
    y: elevationOf(r.levelId) + SURFACE_OFFSET,
  }));

  const terrain: TerrainDescriptor[] = model.terrain.patches.map((p) => ({
    id: p.id,
    name: p.name,
    outline: toOutline(p.outline),
    holes: (p.holes ?? []).map(toOutline),
    bottom: model.terrain.bottomElevation.value,
    top: p.elevation.value,
  }));

  const outdoorAreas: OutdoorAreaDescriptor[] = model.outdoorAreas.map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    ...(a.ownerApartmentId !== undefined && { ownerApartmentId: a.ownerApartmentId }),
    outline: toOutline(a.outline),
    y: a.elevation.value + SURFACE_OFFSET,
  }));

  return {
    levels,
    apartments: model.apartments.map((a) => ({ id: a.id, name: a.name, levelIds: a.levelIds })),
    walls,
    openings,
    slabs,
    roomFloors,
    terrain,
    outdoorAreas,
    bounds: boundsOf([
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

export const FRAME_WIDTH = 0.06;
const FRAME_DEPTH = 0.1;
const GLASS_DEPTH = 0.02;

/**
 * Frame members and glass of an opening, in the opening's local space (centre at the origin,
 * width along x). Windows get a full frame and a pane; doors a frame without a sill, left open.
 */
export function openingParts(opening: Pick<OpeningDescriptor, 'type' | 'size'>) {
  const [w, h, wallDepth] = opening.size;
  const f = Math.min(FRAME_WIDTH, w / 4, h / 4);
  const d = Math.min(FRAME_DEPTH, wallDepth);
  const box = (x: number, y: number, sx: number, sy: number, sz = d): Box => ({
    center: [x, y, 0],
    size: [sx, sy, sz],
    rotationY: 0,
  });
  const frame = [
    box(-w / 2 + f / 2, 0, f, h),
    box(w / 2 - f / 2, 0, f, h),
    box(0, h / 2 - f / 2, w - 2 * f, f),
  ];
  if (opening.type === 'door') return { frame, glass: undefined };
  frame.push(box(0, -h / 2 + f / 2, w - 2 * f, f));
  return { frame, glass: box(0, 0, w - 2 * f, h - 2 * f, GLASS_DEPTH) };
}
