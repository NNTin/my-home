import {
  roofOf,
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

export interface WallSegment extends Box {
  id: string;
  wallId: string;
  levelId: string;
  apartmentId?: string;
  kind: Wall['kind'];
  /**
   * Set when the segment is trimmed by a pitched roof: draw this outline (local along-wall x and
   * height y, relative to `center`) extruded through the wall thickness instead of the box.
   */
  outline?: Vec2[];
}

/** One sloped plane of a pitched roof. */
export interface RoofPlaneDescriptor extends ProfileSolid {
  id: string;
  levelId: string;
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
  /** Planes of a pitched roof; a flat roof is a slab of kind `roof` instead. */
  roofPlanes: RoofPlaneDescriptor[];
  bounds: { min: Vec3; max: Vec3 };
}

/** Room floors and outdoor surfaces float this far above their base to avoid z-fighting. */
export const SURFACE_OFFSET = 0.01;
const EPS = 1e-6;

const toVec2 = (p: Point): Vec2 => [p.x.value, p.z.value];
const toOutline = (polygon: Polygon): Vec2[] => polygon.map(toVec2);

/** Rotation about +y that maps the local +x axis onto the plan direction (dx, dz). */
export const rotationFor = (dx: number, dz: number) => Math.atan2(-dz, dx);

/** World position of the outline point `[x, y]` of a profile solid, at local depth `z`. */
export function solidPoint(solid: ProfileSolid, [x, y]: Vec2, z = 0): Vec3 {
  const c = Math.cos(solid.rotationY);
  const s = Math.sin(solid.rotationY);
  // Same rotation as three.js about +y: (x, z) -> (x cos + z sin, -x sin + z cos).
  const [cx, cy, cz] = solid.center;
  return [cx + x * c + z * s, cy + y, cz - x * s + z * c];
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
export function gableRoofPlanes(g: Gable): RoofPlaneDescriptor[] {
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
  return ([-1, 1] as const).map((side) => ({
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
  }));
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

/** Drops repeated and collinear vertices of a closed polygon. */
function simplify(points: Vec2[]): Vec2[] {
  let result = points;
  for (let changed = true; changed && result.length > 3;) {
    changed = false;
    for (let i = 0; i < result.length; i++) {
      const [ax, ay] = result[(i + result.length - 1) % result.length]!;
      const [bx, by] = result[i]!;
      const [cx, cy] = result[(i + 1) % result.length]!;
      if (Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) < EPS * EPS) {
        result = result.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return result;
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
  const gable = gableOf(model, levels.at(-1));
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
    // Under a gable roof the attic's walls are trimmed to the roof underside, which turns a tall
    // gable-end wall into a gable and knee walls into a flush fit.
    const trim = gable?.levelId === wall.levelId ? roofCeiling(gable, wall, base) : undefined;
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
  const roofPlanes = gable ? gableRoofPlanes(gable) : [];
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
    roofPlanes,
    bounds: boundsOf([
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
