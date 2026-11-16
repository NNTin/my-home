import {
  roofOf,
  wallLength,
  type HomeModel,
  type Opening,
  type Point,
  type Polygon,
  type Slope,
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
}

/** A flat surface at height `y`, or on `slope` (`y` is then the high edge). */
export interface Surface {
  outline: Vec2[];
  y: number;
  slope?: PlaneSlope;
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

/** An opening in an outbuilding wall. */
export interface OutbuildingOpeningDescriptor extends Box {
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
}

/**
 * A window lying on a roof plane. `size` is [along the ridge, thickness, down the slope]; the
 * box is turned by `tilt` about its local x, then by `rotationY` about y (Euler order YXZ), so
 * its local +z runs down the slope.
 */
export interface RoofWindowDescriptor {
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
  walls: WallSegment[];
  openings: OpeningDescriptor[];
  slabs: SlabDescriptor[];
  roomFloors: RoomFloorDescriptor[];
  terrain: TerrainDescriptor[];
  outdoorAreas: OutdoorAreaDescriptor[];
  /** Planes of a pitched roof; a flat roof is a slab of kind `roof` instead. */
  roofPlanes: RoofPlaneDescriptor[];
  roofWindows: RoofWindowDescriptor[];
  outbuildings: OutbuildingDescriptor[];
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
    };
  });

  const outbuildings = (model.outbuildings ?? []).map(buildOutbuilding);
  const roof = roofOf(model.building);
  const roofWindows =
    gable && roof.type === 'gable' ? gableRoofWindows(gable, roof.windows ?? []) : [];

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
    roofWindows,
    outbuildings,
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
): RoofWindowDescriptor[] {
  const tilt = Math.atan(g.slope);
  const top = g.thickness * Math.hypot(1, g.slope);
  return windows.map((w) => {
    const width = w.width.value;
    const length = w.length.value;
    // Horizontal distance from the footprint edge to the window's centre.
    const inset = (w.fromEave.value + length / 2) * Math.cos(tilt);
    const across = w.side === 'max' ? g.across[1] - inset : g.across[0] + inset;
    const along = g.along[0] + w.offset.value + width / 2;
    const y = roofUnderside(g, across) + top + ROOF_WINDOW_THICKNESS / 2 / Math.cos(tilt);
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
      center: g.ridgeAxis === 'x' ? [along, y, across] : [across, y, along],
      size: [width, ROOF_WINDOW_THICKNESS, length],
      rotationY,
      tilt,
    };
  });
}

const ROOF_WINDOW_THICKNESS = 0.06;

/** Walls along every footprint edge (overlapping at the corners), openings and a flat roof. */
export function buildOutbuilding(
  b: NonNullable<HomeModel['outbuildings']>[number],
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
      openings.push({
        id: o.id,
        type: o.type,
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
 * width along x). Windows get a full frame and a pane; doors a frame without a sill, left open;
 * French doors a pane down to the floor; garage doors a closed panel.
 */
export function openingParts(opening: Pick<OpeningDescriptor, 'type' | 'size'>): {
  frame: Box[];
  glass?: Box;
  panel?: Box;
} {
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
  if (opening.type === 'door') return { frame };
  if (opening.type === 'french-door') {
    return { frame, glass: box(0, -f / 2, w - 2 * f, h - f, GLASS_DEPTH) };
  }
  if (opening.type === 'garage-door') {
    return { frame, panel: box(0, -f / 2, w - 2 * f, h - f, GLASS_DEPTH * 2) };
  }
  frame.push(box(0, -h / 2 + f / 2, w - 2 * f, f));
  return { frame, glass: box(0, 0, w - 2 * f, h - 2 * f, GLASS_DEPTH) };
}
