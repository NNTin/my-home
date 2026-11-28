import { stairFinishes, type Stair, type StairFinishes } from '@my-home/shared';
import type { ProfileSolid } from './types';
import type { Box, Vec2, Vec3 } from '../geom/types';
import { EPS, rotationFor, toOutline } from '../geom/plan';

/**
 * A stair (docs/design/realistic-render.md §8.1, docs/home-model.md § Stairs): treads with a
 * nosing on flights that are solids, a railing on the inside of its turn. All of it follows from
 * the walking line and the width of the model; the sizes below are the builder's defaults.
 */

/** Steps are at most this high; the builder adds steps until they are. */
export const MAX_RISER = 0.19;

/** The defaults of every part, in metres. */
export const STAIR_DETAIL = {
  /** The board (or tile) one steps on, and how far it stands out over the riser below. */
  tread: { thickness: 0.03, nosing: 0.02 },
  /** A landing, and a flight above the first one measured down from its landing: open below. */
  slab: 0.2,
  /** A flight between two turns that is shorter than this has no tread: a half landing. */
  minGoing: 0.15,
  /** The floor above is open over every step that is less than this below it. */
  headroom: 2.2,
  /** The board that closes the last riser against the edge of the floor above. */
  riserPlate: 0.01,
  railing: {
    /** How far the railing stands off the flight's edge, where two flights do not say. */
    reach: 0.05,
    post: 0.09,
    /** The top of a post above the handrail it holds. */
    postAbove: 0.1,
    /** The handrail's underside above the line of the nosings, and its section. */
    height: 0.9,
    handrail: 0.045,
    /** The board the balusters stand on: its thickness, and its edges about the nosings' line. */
    stringer: { thickness: 0.04, above: 0.06, below: 0.1 },
    baluster: { diameter: 0.014, spacing: 0.125 },
  },
} as const;

/** An upright round bar. */
export interface Baluster {
  id: string;
  /** Its middle. */
  center: Vec3;
  diameter: number;
  height: number;
}

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
  /** What one walks on, bottom to top: the top of each box is a tread or a landing. */
  steps: (Box & { id: string; part: 'tread' | 'landing' })[];
  /**
   * What carries the treads: each flight seen from its side, extruded over the width. The first
   * flight stands on the floor; the others are slabs, open below.
   */
  flights: (ProfileSolid & { id: string })[];
  /** The slabs under the landings. */
  slabs: (Box & { id: string })[];
  /** On the inside of the turn; a straight stair has none. */
  railing: {
    posts: (Box & { id: string })[];
    rails: (ProfileSolid & { id: string; part: 'stringer' | 'handrail' })[];
    balusters: Baluster[];
  };
  /** Plan rectangle of the stairwell: the opening in the floor it leads up to. */
  well: Vec2[];
  finishes: StairFinishes;
}

/**
 * A stair climbing from `from` to `to` along its walking line. Every turning point gets a square
 * landing, and two turning points closer than a tread share one (a half landing); the remaining
 * steps are shared out over the flights by their length. The last riser arrives on the upper
 * floor, so there is no tread at `to`.
 */
export function buildStair(stair: Stair, from: number, to: number): StairDescriptor {
  const D = STAIR_DETAIL;
  const width = stair.width.value;
  const height = to - from;
  const points = toOutline(stair.path);
  const last = points.length - 2;
  const flights = points.slice(0, -1).map(([sx, sz], i) => {
    const [ex, ez] = points[i + 1]!;
    const length = Math.hypot(ex - sx, ez - sz);
    const dir: Vec2 = [(ex - sx) / length, (ez - sz) / length];
    // A landing takes half a width from the flight on either side of it.
    const start = i > 0 ? width / 2 : 0;
    const run = Math.max(length - (i < last ? width / 2 : 0) - start, 0);
    return {
      origin: [sx, sz] as Vec2,
      corner: [ex, ez] as Vec2,
      dir,
      length,
      start,
      run,
      rotationY: rotationFor(dir[0], dir[1]),
      /** No room for a tread: the landings at its ends are one. */
      link: i > 0 && i < last && run < D.minGoing,
      treads: 0,
      going: 0,
      /** Risers below its first one. */
      base: 0,
    };
  });
  type Flight = (typeof flights)[number];
  const walked = flights.filter((f) => !f.link);
  const landings = flights.length - 1 - (flights.length - walked.length);
  const totalRun = walked.reduce((sum, f) => sum + f.run, 0);
  const wanted = Math.ceil(height / MAX_RISER - EPS) - 1 - landings;
  // Largest-remainder rounding, at least one tread per flight: the sum never falls short of
  // `wanted`, so no riser exceeds MAX_RISER.
  const shares = walked.map((f) => (wanted * f.run) / Math.max(totalRun, EPS));
  walked.forEach((f, i) => (f.treads = Math.max(1, Math.floor(shares[i]! + EPS))));
  const byRemainder = shares
    .map((share, i) => ({ i, remainder: share - Math.floor(share + EPS) }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  const treadCount = () => walked.reduce((sum, f) => sum + f.treads, 0);
  for (let k = 0; treadCount() < wanted; k++)
    walked[byRemainder[k % byRemainder.length]!.i]!.treads++;
  const rise = height / (treadCount() + landings + 1);

  /** A point of a flight's line: `along` it from its origin, `aside` to its right. */
  const at = (f: Flight, along: number, aside = 0): Vec2 => [
    f.origin[0] + f.dir[0] * along - f.dir[1] * aside,
    f.origin[1] + f.dir[1] * along + f.dir[0] * aside,
  ];
  const steps: StairDescriptor['steps'] = [];
  const slabs: StairDescriptor['slabs'] = [];
  /** The plan corners of every step, without its nosing, and its height above `from`. */
  const footprints: { corners: Vec2[]; top: number }[] = [];
  let level = 0;
  const step = (
    part: 'tread' | 'landing',
    f: Flight,
    along: number,
    depth: number,
    nosing: number,
  ) => {
    level++;
    const top = rise * level;
    const [x, z] = at(f, along - nosing / 2);
    const id = `${stair.id}:${steps.length}:${part}`;
    steps.push({
      id,
      part,
      center: [x, from + top - D.tread.thickness / 2, z],
      size: [depth + nosing, D.tread.thickness, width],
      rotationY: f.rotationY,
    });
    footprints.push({
      top,
      corners: [-1, 1].flatMap((i) =>
        [-1, 1].map((j) => at(f, along + (i * depth) / 2, (j * width) / 2)),
      ),
    });
    if (part === 'landing') {
      const [cx, cz] = at(f, along);
      const thickness = D.slab - D.tread.thickness;
      slabs.push({
        id: `${id}:slab`,
        center: [cx, from + top - D.tread.thickness - thickness / 2, cz],
        size: [depth, thickness, width],
        rotationY: f.rotationY,
      });
    }
  };
  flights.forEach((f, i) => {
    f.base = level;
    if (f.link) return;
    f.going = f.run / f.treads;
    for (let j = 0; j < f.treads; j++) {
      step('tread', f, f.start + (j + 0.5) * f.going, f.going, D.tread.nosing);
    }
    if (i === last) return;
    // The flights without a tread that follow: their turning points share this landing.
    let end = i + 1;
    while (flights[end]!.link) end++;
    if (end === i + 1) step('landing', f, f.length, width, 0);
    else {
      const link = flights[i + 1]!;
      const reach = Math.hypot(
        flights[end - 1]!.corner[0] - f.corner[0],
        flights[end - 1]!.corner[1] - f.corner[1],
      );
      step('landing', link, reach / 2, reach + width, 0);
    }
  });

  // On the plan (x east, z south) a left turn, counter-clockwise from above, has a negative cross.
  const cross = flights
    .slice(1)
    .reduce((sum, f, i) => sum + flights[i]!.dir[0] * f.dir[1] - flights[i]!.dir[1] * f.dir[0], 0);
  const turn = Math.abs(cross) < EPS ? 'straight' : cross < 0 ? 'counter-clockwise' : 'clockwise';

  /** The line through a flight's nosings, above `from`. */
  const nosings = (f: Flight, along: number) =>
    rise * (f.base + 1) + ((along - f.start) * rise) / f.going;
  const solid = (f: Flight, aside: number, depth: number, outline: Vec2[]) => {
    const [x, z] = at(f, 0, aside);
    return { center: [x, from, z] as Vec3, rotationY: f.rotationY, depth, outline };
  };

  const bodies = walked.map((f, i) => {
    const end = f.start + f.run;
    const tread = (j: number) => rise * (f.base + j) - D.tread.thickness;
    // The first flight stands on the floor; the others hang between their landings.
    const under = i === 0 ? () => 0 : (along: number) => nosings(f, along) - rise - D.slab;
    const outline: Vec2[] = [
      [f.start, under(f.start)],
      [end, under(end)],
    ];
    // Arriving on the floor above, the last riser is a board against the floor's edge.
    if (f === flights[last]) {
      outline.push(
        [end, height],
        [end - D.riserPlate, height],
        [end - D.riserPlate, tread(f.treads)],
      );
    } else outline.push([end, tread(f.treads)]);
    for (let j = f.treads; j >= 1; j--) {
      const front = f.start + (j - 1) * f.going;
      if (j < f.treads) outline.push([front + f.going, tread(j)]);
      outline.push([front, tread(j)]);
    }
    return { id: `${stair.id}:flight:${i}`, ...solid(f, 0, width, outline) };
  });

  const railing: StairDescriptor['railing'] = { posts: [], rails: [], balusters: [] };
  if (turn !== 'straight') {
    const R = D.railing;
    // The inside of the turn is to the right going up a clockwise stair.
    const side = turn === 'clockwise' ? 1 : -1;
    const links = flights.filter((f) => f.link);
    // Two flights side by side share the railing between them.
    const aside =
      width / 2 +
      (links.length > 0 ? Math.min(...links.map((f) => f.length - width)) / 2 : R.reach);
    const post = (f: Flight, along: number, bottom: number, top: number) => {
      const [x, z] = at(f, along, side * aside);
      railing.posts.push({
        id: `${stair.id}:post:${railing.posts.length}`,
        center: [x, from + (bottom + top) / 2, z],
        size: [R.post, top - bottom, R.post],
        rotationY: f.rotationY,
      });
    };
    walked.forEach((f, i) => {
      const upper = f === flights[last];
      // From the post beside the second riser, or at the turn below, to the post at the turn above.
      const a0 = i === 0 ? f.start + f.going + R.post / 2 : aside;
      const a1 = upper ? f.length - R.post / 2 : f.length - aside;
      const floor = rise * f.base;
      const rail = (along: number) => nosings(f, along) + R.height;
      const bottom = (along: number) => nosings(f, along) - rise - R.stringer.below;
      if (i === 0) post(f, a0, floor, rail(a0) + R.handrail + R.postAbove);
      // A post at a turn also holds the handrail of the next flight, which starts higher on it.
      const next = walked[i + 1];
      const held = Math.max(rail(a1), next ? nosings(next, aside + R.post / 2) + R.height : 0);
      post(f, a1, Math.max(bottom(a1), floor), held + R.handrail + R.postAbove);
      const [r0, r1] = [a0 + R.post / 2, a1 - R.post / 2];
      if (r1 - r0 < R.baluster.spacing) return;
      // The board ends on the floor or landing the flight starts from.
      const landed = f.start + (R.stringer.below * f.going) / rise;
      const top = (along: number) => nosings(f, along) + R.stringer.above;
      railing.rails.push(
        {
          id: `${stair.id}:stringer:${i}`,
          part: 'stringer',
          ...solid(f, side * aside, R.stringer.thickness, [
            [r0, Math.max(bottom(r0), floor)],
            ...(r0 < landed - EPS && landed < r1 - EPS ? [[landed, floor] as Vec2] : []),
            [r1, Math.max(bottom(r1), floor)],
            [r1, top(r1)],
            [r0, top(r0)],
          ]),
        },
        {
          id: `${stair.id}:handrail:${i}`,
          part: 'handrail',
          ...solid(f, side * aside, R.handrail, [
            [r0, rail(r0)],
            [r1, rail(r1)],
            [r1, rail(r1) + R.handrail],
            [r0, rail(r0) + R.handrail],
          ]),
        },
      );
      const count = Math.ceil((r1 - r0) / R.baluster.spacing - EPS) - 1;
      for (let k = 1; k <= count; k++) {
        const along = r0 + (k * (r1 - r0)) / (count + 1);
        const [x, z] = at(f, along, side * aside);
        railing.balusters.push({
          id: `${stair.id}:baluster:${railing.balusters.length}`,
          center: [x, from + (top(along) + rail(along)) / 2, z],
          diameter: R.baluster.diameter,
          height: rail(along) - top(along),
        });
      }
    });
  }

  // The floor above is open where one would hit one's head on it.
  const open = footprints.filter((s) => s.top > height - D.headroom).flatMap((s) => s.corners);
  const xs = open.map(([x]) => x);
  const zs = open.map(([, z]) => z);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  return {
    id: stair.id,
    name: stair.name,
    levelId: stair.levelId,
    toLevelId: stair.toLevelId,
    ...(stair.apartmentId !== undefined && { apartmentId: stair.apartmentId }),
    turn,
    rise,
    steps,
    flights: bodies,
    slabs,
    railing,
    finishes: stairFinishes(stair),
    well: [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ],
  };
}
