import { resolveFinish, type Chimney, type ResolvedFinish } from '@my-home/shared';
import type { Box, Gable, ProfileSolid, Vec2, Vec3 } from './buildHome';
import { EPS } from './plan';
import type { FaceRun, WallCut, WallEnd } from './wallFaces';

/**
 * Shell detail (docs/design/realistic-render.md §8.1): skirting, the linings and thresholds of
 * doors, and the trim of a pitched roof. All of it is derived from the walls, openings and roof
 * the model has; nothing here moves or resizes them. The sizes are the builder's defaults, not
 * measurements: each can become a value of the home model when a photo shows otherwise.
 */

const paint = (tint: string): ResolvedFinish =>
  resolveFinish(undefined, { finish: 'paint.plain', tint });

/** The defaults of every detail, in metres. */
export const SHELL_DETAIL = {
  skirting: { height: 0.07, depth: 0.012, finish: paint('#f1efe9') },
  /** The board that lines a doorway through an inner wall. */
  lining: { thickness: 0.015 },
  /** How far a threshold stands above the floor. */
  threshold: { height: 0.01, finish: paint('#9c9a94') },
  eavesBoard: { thickness: 0.025, drop: 0.03, finish: paint('#f1efe9') },
  gutter: {
    radius: 0.07,
    wall: 0.012,
    /** The rim lies this far below the roof's top edge. */
    drop: 0.03,
    segments: 8,
    finish: resolveFinish(undefined, { finish: 'metal.brushed', tint: '#9aa0a3' }),
  },
  ridgeCap: { halfWidth: 0.16, thickness: 0.04 },
  /** A chimney's box starts this far below the roof's top face, at its lowest edge. */
  chimney: { sink: 0.05, flue: resolveFinish(undefined, { finish: 'metal.brushed' }) },
} as const;

/** A wall in the plan, as the details need it. */
export interface DetailWall {
  id: string;
  levelId: string;
  apartmentId?: string;
  /** World position along the wall (from its start) at height `y`, `across` metres to its +z. */
  at: (along: number, y: number, across?: number) => Vec3;
  rotationY: number;
  /** The floor the wall stands on. */
  base: number;
  length: number;
  thickness: number;
}

/** A length of skirting board: a box at the foot of a wall face. */
export interface SkirtingDescriptor extends Box {
  id: string;
  wallId: string;
  roomId: string;
  levelId: string;
  apartmentId?: string;
  finish: ResolvedFinish;
}

/**
 * The skirting of one wall: along every stretch of its long faces that borders a room, broken
 * at each opening that reaches the floor, and around an end that stands free in a room. A
 * length goes one board's depth past its stretch, so two lengths meet in a corner. `lift` is how
 * far the floor's surface lies above the wall's foot.
 */
export function wallSkirting(
  wall: DetailWall,
  runs: Record<1 | -1, readonly FaceRun[]>,
  ends: readonly [WallEnd, WallEnd],
  cuts: readonly WallCut[],
  lift: number,
): SkirtingDescriptor[] {
  const { height, depth, finish } = SHELL_DETAIL.skirting;
  const tall = lift + height;
  const doors = cuts
    .filter((c) => c.bottom < height)
    .map((c): Vec2 => [c.from, c.to])
    .sort((a, b) => a[0] - b[0]);
  const common = {
    wallId: wall.id,
    levelId: wall.levelId,
    ...(wall.apartmentId !== undefined && { apartmentId: wall.apartmentId }),
    finish,
  };
  const boards: SkirtingDescriptor[] = [];
  for (const side of [1, -1] as const) {
    for (const run of runs[side]) {
      if (run.roomId === undefined) continue;
      // The stretch without its doors; an edge at a door is cut square, any other goes on.
      let from = run.from;
      const lengths: [number, number][] = [];
      for (const [a, b] of doors) {
        if (b <= from || a >= run.to) continue;
        if (a - from > EPS) lengths.push([from - (from === run.from ? depth : 0), a]);
        from = Math.max(from, b);
      }
      if (run.to - from > EPS)
        lengths.push([from - (from === run.from ? depth : 0), run.to + depth]);
      for (const [a, b] of lengths) {
        boards.push({
          ...common,
          id: `${wall.id}/skirting:${side > 0 ? 'front' : 'back'}-${boards.length}`,
          roomId: run.roomId,
          center: wall.at((a + b) / 2, wall.base + tall / 2, side * (wall.thickness + depth) * 0.5),
          size: [b - a, tall, depth],
          rotationY: wall.rotationY,
        });
      }
    }
  }
  ends.forEach((end, which) => {
    if (end.roomId === undefined) return;
    const along = which === 0 ? -depth / 2 : wall.length + depth / 2;
    boards.push({
      ...common,
      id: `${wall.id}/skirting:${which === 0 ? 'start' : 'end'}`,
      roomId: end.roomId,
      center: wall.at(along, wall.base + tall / 2),
      size: [depth, tall, wall.thickness + 2 * depth],
      rotationY: wall.rotationY,
    });
  });
  return boards;
}

/** The reveal of a door: the boards that line the wall's depth, and the threshold. */
export interface DoorRevealDescriptor {
  id: string;
  openingId: string;
  wallId: string;
  levelId: string;
  apartmentId?: string;
  parts: (Box & { id: string; part: 'jamb' | 'head' | 'threshold'; finish: ResolvedFinish })[];
}

/**
 * The reveal of a door, from the wall's depth: a threshold across the doorway, and with `lining`
 * (a door through an inner wall) boards on both jambs and under the head, in the colour of the
 * door's frame. The frame itself stays the door piece's.
 */
export function doorReveal(
  wall: DetailWall,
  door: WallCut,
  lift: number,
  lining: { color: string } | undefined,
): DoorRevealDescriptor {
  const t = SHELL_DETAIL.lining.thickness;
  const width = door.to - door.from;
  const mid = (door.from + door.to) / 2;
  const depth = wall.thickness;
  const sill = lift + SHELL_DETAIL.threshold.height;
  const wood = lining && paint(lining.color);
  const part = (
    id: 'jamb-left' | 'jamb-right' | 'head' | 'threshold',
    along: number,
    y: number,
    size: Vec3,
    finish: ResolvedFinish,
  ) => ({
    id: `${door.id}/${id}`,
    part: id === 'head' || id === 'threshold' ? id : ('jamb' as const),
    finish,
    center: wall.at(along, wall.base + y),
    size,
    rotationY: wall.rotationY,
  });
  return {
    id: `${door.id}/reveal`,
    openingId: door.id,
    wallId: wall.id,
    levelId: wall.levelId,
    ...(wall.apartmentId !== undefined && { apartmentId: wall.apartmentId }),
    parts: [
      ...(wood
        ? [
            part('jamb-left', door.from + t / 2, door.top / 2, [t, door.top, depth], wood),
            part('jamb-right', door.to - t / 2, door.top / 2, [t, door.top, depth], wood),
            part('head', mid, door.top - t / 2, [width - 2 * t, t, depth], wood),
          ]
        : []),
      part('threshold', mid, sill / 2, [width, sill, depth], wood ?? SHELL_DETAIL.threshold.finish),
    ],
  };
}

/** A length of roof trim: a profile across the ridge, extruded along it. */
export interface RoofTrimDescriptor extends ProfileSolid {
  id: string;
  part: 'eaves-board' | 'gutter' | 'ridge-cap';
  levelId: string;
  finish: ResolvedFinish;
}

/**
 * The trim of a gable roof, in the frame of its planes (`frame`: x across the ridge, y up, z
 * along it): a board on each eave's edge, a half-round gutter in front of it and a cap over the
 * ridge. `roof` is the finish of the planes, which the cap shares.
 */
export function gableRoofTrim(
  g: Gable,
  frame: Pick<ProfileSolid, 'center' | 'rotationY' | 'depth'>,
  roof: ResolvedFinish,
): RoofTrimDescriptor[] {
  const half = (g.across[1] - g.across[0]) / 2;
  const reach = half + g.overhang;
  const eaveY = g.eaveY - g.overhang * g.slope;
  // Vertical thickness of the roof, and the height of its top face `x` across from the ridge.
  const t = g.thickness * Math.hypot(1, g.slope);
  const top = (x: number) => g.eaveY + (half - Math.abs(x)) * g.slope + t;
  const { eavesBoard, gutter, ridgeCap } = SHELL_DETAIL;
  const trim = (
    id: string,
    part: RoofTrimDescriptor['part'],
    finish: ResolvedFinish,
    outline: Vec2[],
  ): RoofTrimDescriptor => ({
    ...frame,
    id: `roof:${id}`,
    part,
    levelId: g.levelId,
    finish,
    outline,
  });

  const { halfWidth: w, thickness: c } = ridgeCap;
  const result = [
    trim('ridge-cap', 'ridge-cap', roof, [
      [-w, top(w)],
      [0, top(0)],
      [w, top(w)],
      [w, top(w) + c],
      [0, top(0) + c],
      [-w, top(w) + c],
    ]),
  ];
  for (const side of [-1, 1] as const) {
    const name = side < 0 ? 'min' : 'max';
    const [x0, x1] = [side * reach, side * (reach + eavesBoard.thickness)];
    result.push(
      trim(`eaves-board:${name}`, 'eaves-board', eavesBoard.finish, [
        [x0, eaveY - eavesBoard.drop],
        [x1, eaveY - eavesBoard.drop],
        [x1, eaveY + t],
        [x0, eaveY + t],
      ]),
    );
    // A half ring, open to the sky, hung on the board.
    const cx = x1 + side * gutter.radius;
    const cy = eaveY + t - gutter.drop;
    const arc = (r: number) =>
      Array.from({ length: gutter.segments + 1 }, (_, k): Vec2 => {
        const a = Math.PI + (Math.PI * k) / gutter.segments;
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      });
    result.push(
      trim(`gutter:${name}`, 'gutter', gutter.finish, [
        ...arc(gutter.radius),
        ...arc(gutter.radius - gutter.wall).reverse(),
      ]),
    );
  }
  return result;
}

/** A chimney on a pitched roof: its box and the pipes standing on it. */
export interface ChimneyDescriptor {
  id: string;
  name: string;
  levelId: string;
  stack: Box;
  flues: { id: string; center: Vec3; diameter: number; height: number }[];
  finish: ResolvedFinish;
  flueFinish: ResolvedFinish;
}

/**
 * The chimneys of a gable roof (D111): a box from just under the roof's top face, where it is
 * lowest under the chimney, up to the chimney's top, and an upright cylinder for each pipe from
 * the chimney's top to its own. `facade` is the building's facade finish, the default of a side.
 */
export function gableChimneys(
  g: Gable,
  chimneys: readonly Chimney[],
  facade: ResolvedFinish,
): ChimneyDescriptor[] {
  const half = (g.across[1] - g.across[0]) / 2;
  const t = g.thickness * Math.hypot(1, g.slope);
  const top = (across: number) => g.eaveY + (half - Math.abs(across - g.ridge)) * g.slope + t;
  return chimneys.map((c) => {
    const [x, z, w, d] = [c.x.value, c.z.value, c.width.value, c.depth.value];
    const [u, du] = g.ridgeAxis === 'x' ? [z, d] : [x, w];
    const bottom = Math.min(top(u - du / 2), top(u + du / 2)) - SHELL_DETAIL.chimney.sink;
    const height = c.top.value - bottom;
    return {
      id: c.id,
      name: c.name,
      levelId: g.levelId,
      stack: { center: [x, bottom + height / 2, z], size: [w, height, d], rotationY: 0 },
      flues: (c.flues ?? []).map((f, i) => {
        const rise = f.top.value - c.top.value;
        return {
          id: `${c.id}:flue:${i}`,
          center: [f.x.value, c.top.value + rise / 2, f.z.value] as Vec3,
          diameter: f.diameter.value,
          height: rise,
        };
      }),
      finish: c.finish ? resolveFinish(c.finish, { finish: 'render.facade' }) : facade,
      flueFinish: SHELL_DETAIL.chimney.flue,
    };
  });
}
