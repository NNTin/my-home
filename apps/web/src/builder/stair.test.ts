import { HomeModel, type Stair } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import realHomeJson from '../../../../data/homes/home.json';
import { buildHome, solidPoint } from './buildHome';
import type { Vec2 } from '../geom/types';
import { shellItems } from './drawList';
import { buildStair, MAX_RISER, STAIR_DETAIL } from './stair';

// The stair (docs/design/realistic-render.md §8.1, docs/home-model.md § Stairs): treads with a
// nosing on flights that are solids, one landing where it turns back beside itself, and a
// railing on the inside of the turn.

const model = HomeModel.parse(structuredClone(realHomeJson));
const home = buildHome(model);
const stair = home.stairs[0]!;
const source = model.stairs![0]!;
const FLOOR = -2.6;
const D = STAIR_DETAIL;

const dim = (value: number) => ({ value, source: 'mock' as const });
const point = (x: number, z: number) => ({ x: dim(x), z: dim(z) });
const along = (path: [number, number][], rest: Partial<Stair> = {}): Stair => ({
  ...source,
  path: path.map(([x, z]) => point(x, z)),
  ...rest,
});
const top = (box: { center: number[]; size: number[] }) => box.center[1]! + box.size[1]! / 2;
const bottom = (box: { center: number[]; size: number[] }) => box.center[1]! - box.size[1]! / 2;
/** The signed area of an outline: positive when it runs anticlockwise. */
const area = (outline: Vec2[]) =>
  outline.reduce((sum, [x, y], i) => {
    const [nx, ny] = outline[(i + 1) % outline.length]!;
    return sum + (x * ny - nx * y) / 2;
  }, 0);

describe('the stair of the real home', () => {
  it('climbs to the ground floor in fourteen even risers: eight, a landing, six', () => {
    expect(stair).toMatchObject({ levelId: 'souterrain', toLevelId: 'ground-floor' });
    expect(stair.rise).toBeCloseTo(2.6 / 14);
    expect(stair.rise).toBeLessThanOrEqual(MAX_RISER);
    expect(stair.steps.map((s) => s.part).join(' ')).toBe(
      [...Array(7).fill('tread'), 'landing', ...Array(5).fill('tread')].join(' '),
    );
    stair.steps.forEach((s, i) => expect(top(s)).toBeCloseTo(FLOOR + stair.rise * (i + 1)));
    // The last riser arrives on the upper floor.
    expect(top(stair.steps.at(-1)!) + stair.rise).toBeCloseTo(0);
  });

  it('turns clockwise: north along the west wall, across under the window, south on the east', () => {
    expect(stair.turn).toBe('clockwise');
    const [first, landing, last] = [stair.steps[0]!, stair.steps[7]!, stair.steps.at(-1)!];
    const lower = stair.steps.slice(0, 7);
    const upper = stair.steps.slice(8);
    for (const s of lower) expect(s.center[0]).toBeCloseTo(0.985);
    for (const s of upper) expect(s.center[0]).toBeCloseTo(2.09);
    lower.slice(1).forEach((s, i) => expect(s.center[2]).toBeLessThan(lower[i]!.center[2]));
    upper.slice(1).forEach((s, i) => expect(s.center[2]).toBeGreaterThan(upper[i]!.center[2]));
    expect(landing.center[2]).toBeLessThan(lower.at(-1)!.center[2]);
    expect(first.center[2]).toBeGreaterThan(last.center[2]);
  });

  it('has one landing across the hall, as deep as a flight is wide', () => {
    const landings = stair.steps.filter((s) => s.part === 'landing');
    expect(landings).toHaveLength(1);
    const [landing] = landings;
    // From the lower flight's outer edge to the upper one's, along the line that joins them.
    expect(landing!.size).toEqual([
      expect.closeTo(2.09 - 0.985 + 1),
      D.tread.thickness,
      expect.closeTo(1),
    ]);
    expect(landing!.center[0]).toBeCloseTo((0.985 + 2.09) / 2);
    expect(landing!.center[2]).toBeCloseTo(-9.965);
    // It stays 5 mm clear of the hall's three walls.
    const hall = model.rooms.find((r) => r.id === 'souterrain-stair-hall')!;
    const xs = hall.outline.map((p) => p.x.value);
    expect(landing!.center[0] - landing!.size[0] / 2).toBeCloseTo(Math.min(...xs) + 0.005);
    expect(landing!.center[0] + landing!.size[0] / 2).toBeCloseTo(2.715 - 0.12 - 0.005);
  });

  it('has treads of one going that stand out over the riser below', () => {
    const treads = stair.steps.filter((s) => s.part === 'tread');
    for (const tread of treads) {
      expect(tread.size).toEqual([
        expect.closeTo(0.26 + D.tread.nosing),
        D.tread.thickness,
        expect.closeTo(1),
      ]);
    }
    // The first tread's edge is 2 cm in front of the first riser, at the walking line's start.
    expect(treads[0]!.center[2] + treads[0]!.size[0] / 2).toBeCloseTo(-7.645 + D.tread.nosing);
  });

  it('carries the lower flight on the floor and leaves the upper one open below', () => {
    const [lower, upper] = stair.flights;
    expect(stair.flights).toHaveLength(2);
    const heights = (flight: typeof lower) => flight!.outline.map(([, y]) => y);
    expect(Math.min(...heights(lower))).toBe(0);
    // The upper flight hangs from the landing's underside up to the floor above.
    const landing = stair.steps[7]!;
    expect(FLOOR + Math.min(...heights(upper))).toBeCloseTo(top(landing) - D.slab);
    expect(Math.max(...heights(upper))).toBeCloseTo(2.6);
    expect(stair.slabs).toHaveLength(1);
    expect(top(stair.slabs[0]!)).toBeCloseTo(bottom(landing));
    expect(bottom(stair.slabs[0]!)).toBeCloseTo(top(landing) - D.slab);
    // 1.29 m of headroom under the landing, and more under the flight: a place to store things.
    expect(bottom(stair.slabs[0]!) - FLOOR).toBeGreaterThan(1.25);
  });

  it('puts every tread on its flight: nothing hangs in the air', () => {
    for (const [i, flight] of stair.flights.entries()) {
      expect(area(flight.outline)).toBeGreaterThan(0);
      const treads = i === 0 ? stair.steps.slice(0, 7) : stair.steps.slice(8);
      for (const tread of treads) {
        const under = flight.outline.filter(([, y]) => Math.abs(FLOOR + y - bottom(tread)) < 1e-9);
        // The top of the step below it: two points of the outline, one going apart.
        expect(under).toHaveLength(2);
        expect(Math.abs(under[0]![0] - under[1]![0])).toBeCloseTo(
          i === 0 || tread !== treads.at(-1) ? 0.26 : 0.26 - D.riserPlate,
        );
      }
    }
  });

  it('opens the floor above where one would hit one’s head, not over the first two steps', () => {
    const [x0, z0] = stair.well[0]!;
    const [x1, z1] = stair.well[2]!;
    expect([x0, x1]).toEqual([expect.closeTo(0.485), expect.closeTo(2.59)]);
    expect(z0).toBeCloseTo(-10.465);
    // Its south edge is where the upper flight arrives, and the third riser of the lower one.
    expect(z1).toBeCloseTo(-8.165);
    expect(z1).toBeCloseTo(-7.645 - 2 * 0.26);
    const ceiling = home.roomCeilings.find((c) => c.roomId === 'souterrain-stair-hall')!;
    expect(ceiling.holes).toEqual([stair.well]);
    expect(home.slabs.find((s) => s.id === 'ground-floor:floor')!.holes).toEqual([stair.well]);
  });
});

describe('the railing', () => {
  const R = D.railing;
  const { posts, rails, balusters } = stair.railing;
  const plan = (rail: (typeof rails)[number], x: number) => solidPoint(rail, [x, 0]);

  it('stands between the two flights, on the inside of the turn', () => {
    expect(posts).toHaveLength(3);
    expect(rails.map((r) => r.part)).toEqual(['stringer', 'handrail', 'stringer', 'handrail']);
    const between = (0.985 + 2.09) / 2;
    for (const post of posts) expect(post.center[0]).toBeCloseTo(between);
    for (const rail of rails) expect(rail.center[0]).toBeCloseTo(between);
    for (const b of balusters) expect(b.center[0]).toBeCloseTo(between);
  });

  it('has a post beside the second riser, one at the landing and one at the top', () => {
    const [foot, turn, last] = posts;
    expect(bottom(foot!)).toBeCloseTo(FLOOR);
    expect(foot!.center[2]).toBeCloseTo(-7.645 - 0.26 - R.post / 2);
    // At the landing's edge, from under the lower flight's board to above the upper handrail.
    expect(turn!.center[2]).toBeCloseTo(-9.965 + (2.09 - 0.985) / 2);
    const landing = top(stair.steps[7]!);
    expect(bottom(turn!)).toBeLessThan(landing - 0.2);
    // It stands 10 cm over the top of the upper flight's handrail, which starts at its face.
    const upper = rails[3]!;
    const handrailTop = FLOOR + Math.max(upper.outline[0]![1], upper.outline[3]![1]);
    expect(upper.outline[0]![0]).toBeCloseTo((2.09 - 0.985) / 2 + R.post / 2);
    expect(top(turn!)).toBeCloseTo(handrailTop + R.postAbove);
    expect(top(turn!)).toBeGreaterThan(FLOOR + rails[1]!.outline[2]![1] + R.postAbove);
    expect(last!.center[2]).toBeCloseTo(-8.165 - R.post / 2);
    expect(top(last!)).toBeCloseTo(
      R.height + R.handrail + R.postAbove - stair.rise * (R.post / 2 / 0.26),
    );
  });

  it('carries a handrail 90 cm above the nosings, from post to post', () => {
    const lower = rails[1]!;
    const [a, b] = lower.outline;
    // Rising one riser per going.
    expect((b![1] - a![1]) / (b![0] - a![0])).toBeCloseTo(stair.rise / 0.26);
    // Over the edge of the third tread (two goings and 2 cm of nosing from the first riser).
    const third = stair.steps[2]!;
    const x = 2 * 0.26;
    const y = a![1] + ((x - a![0]) * stair.rise) / 0.26;
    expect(FLOOR + y - top(third)).toBeCloseTo(R.height);
    expect(lower.depth).toBe(R.handrail);
    // It meets the faces of its posts.
    expect(plan(lower, a![0])[2]).toBeCloseTo(posts[0]!.center[2] - R.post / 2);
    expect(plan(lower, b![0])[2]).toBeCloseTo(posts[1]!.center[2] + R.post / 2);
  });

  it('has a board under the balusters, which stands on the landing where a flight starts from one', () => {
    for (const [i, board] of [rails[0]!, rails[2]!].entries()) {
      expect(area(board.outline)).toBeGreaterThan(0);
      // The lower one starts at the post beside the second riser, a little above the floor.
      const floor = i === 0 ? 0 : top(stair.steps[7]!) - FLOOR;
      const lowest = Math.min(...board.outline.map(([, y]) => y));
      if (i === 0)
        expect(lowest - floor).toBeCloseTo(
          stair.rise + (D.railing.post * stair.rise) / 0.26 - D.railing.stringer.below,
        );
      else expect(lowest).toBeCloseTo(floor);
      // No board dips under the line of its lower edge.
      const [a, b] = [board.outline[0]!, board.outline.at(-3)!];
      for (const [x, y] of board.outline.slice(1, -3)) {
        expect(y).toBeGreaterThanOrEqual(Math.min(a[1], b[1]) - 1e-9);
        expect(x).toBeGreaterThan(a[0]);
      }
      expect(board.depth).toBe(R.stringer.thickness);
    }
  });

  it('has upright bars at most 12.5 cm apart, from the board to the handrail', () => {
    expect(balusters.length).toBeGreaterThan(15);
    // The lower flight's bars come first, going north; the upper flight's go south again.
    const turn = balusters.findIndex(
      (b, i) => i > 0 && b.center[2] > balusters[i - 1]!.center[2] - 0.05,
    );
    const lower = balusters.slice(0, turn);
    const zs = [posts[0]!.center[2], ...lower.map((b) => b.center[2]), posts[1]!.center[2]];
    zs.slice(1).forEach((z, i) => {
      expect(zs[i]! - z).toBeGreaterThan(0.05);
      expect(zs[i]! - z).toBeLessThanOrEqual(R.baluster.spacing + R.post / 2 + 1e-9);
    });
    for (const b of balusters) {
      expect(b.diameter).toBe(R.baluster.diameter);
      expect(b.height).toBeCloseTo(R.height - R.stringer.above);
    }
  });
});

describe('the stair in the draw list', () => {
  const items = shellItems(home).filter((i) => i.id.startsWith(`${stair.id}:`));
  const of = (part: string) => items.filter((i) => i.id.includes(`:${part}`));

  it('is closed solids of the souterrain: boxes, profiles and round bars', () => {
    expect(items).toHaveLength(13 + 2 + 1 + 3 + 4 + stair.railing.balusters.length);
    for (const item of items) {
      expect(item.closed).toBe(true);
      expect(item.group).toEqual({
        kind: 'level',
        levelId: 'souterrain',
        apartmentId: 'apt-souterrain',
      });
    }
    expect(of('flight:').map((i) => i.shape.kind)).toEqual(['profile', 'profile']);
    expect(of('handrail:').map((i) => i.shape.kind)).toEqual(['profile', 'profile']);
    expect(of('baluster:')[0]!.shape).toEqual({
      kind: 'cylinder',
      diameter: D.railing.baluster.diameter,
      height: expect.closeTo(D.railing.height - D.railing.stringer.above),
    });
  });

  it('draws the treads as the hall’s floor, the risers white, the railing in wood and steel', () => {
    expect(of('tread')[0]).toMatchObject({ finish: 'wood.oak-laminate', tint: '#edd5b0' });
    expect(of('landing')[0]).toMatchObject({ finish: 'wood.oak-laminate', tint: '#edd5b0' });
    expect(of('flight:')[0]!.finish).toBe('paint.plain');
    expect(of('post:')[0]!.finish).toBe('wood.veneer');
    expect(of('stringer:')[0]!.finish).toBe('wood.veneer');
    expect(of('baluster:')[0]!.finish).toBe('metal.brushed');
  });
});

describe('any stair', () => {
  it('reports the turn of a mirrored and of a straight stair', () => {
    const mirrored = buildStair(
      along([
        [0, 0],
        [0, -2],
        [-2, -2],
        [-2, 0],
      ]),
      0,
      2.6,
    );
    expect(mirrored.turn).toBe('counter-clockwise');
    // Its railing is on the other side: to the left going up, which is west going north.
    expect(mirrored.railing.posts[0]!.center[0]).toBeCloseTo(-0.5 - D.railing.reach);
    const straight = buildStair(
      along([
        [0, 0],
        [3, 0],
      ]),
      0,
      1.9,
    );
    expect(straight.turn).toBe('straight');
    expect(straight.steps).toHaveLength(9);
    expect(straight.steps.every((s) => s.part === 'tread')).toBe(true);
    expect(straight.steps[0]!.size).toEqual([
      expect.closeTo(3 / 9 + D.tread.nosing),
      D.tread.thickness,
      1,
    ]);
    expect(straight.railing).toEqual({ posts: [], rails: [], balusters: [] });
    expect(straight.flights).toHaveLength(1);
    // Less than the headroom below the floor above from its first step on: open over all of it.
    expect(straight.well).toEqual([
      [expect.closeTo(0), -0.5],
      [expect.closeTo(3), -0.5],
      [expect.closeTo(3), 0.5],
      [expect.closeTo(0), 0.5],
    ]);
  });

  it('never exceeds the maximum riser, however the treads divide over the flights', () => {
    // Three equal flights of 2 m (after the landings) and a 2.4 m rise: 13 risers are needed, so
    // 10 treads over three flights; rounding each share of 3.33 down would leave only 12 risers.
    const equal = buildStair(
      along([
        [0, 0],
        [0, -2.5],
        [3, -2.5],
        [3, 0],
      ]),
      0,
      2.4,
    );
    expect(equal.rise).toBeLessThanOrEqual(MAX_RISER + 1e-9);
    expect(equal.steps.filter((s) => s.part === 'tread')).toHaveLength(10);
    expect(equal.rise).toBeCloseTo(2.4 / 13);
  });

  it('gives each turning point its own square landing when a tread fits between them', () => {
    const wide = buildStair(
      along([
        [0, 0],
        [0, -2.5],
        [3, -2.5],
        [3, 0],
      ]),
      0,
      2.4,
    );
    const landings = wide.steps.filter((s) => s.part === 'landing');
    expect(landings.map((l) => l.size)).toEqual([
      [1, D.tread.thickness, 1],
      [1, D.tread.thickness, 1],
    ]);
    expect(top(landings[1]!)).toBeGreaterThan(top(landings[0]!));
    expect(wide.flights).toHaveLength(3);
    // A post at the inner corner of each landing, one at the foot and one at the top.
    const reach = 0.5 + D.railing.reach;
    expect(wide.railing.posts.map((p) => [p.center[0], p.center[2]])).toEqual([
      // Four treads of 0.5 on the first flight: the post stands beside its second riser.
      [expect.closeTo(reach), expect.closeTo(-0.5 - D.railing.post / 2)],
      [expect.closeTo(reach), expect.closeTo(-2.5 + reach)],
      [expect.closeTo(3 - reach), expect.closeTo(-2.5 + reach)],
      [expect.closeTo(3 - reach), expect.closeTo(-D.railing.post / 2)],
    ]);
  });

  it('joins two turning points in one landing when no tread fits between them', () => {
    const gap = D.minGoing - 0.01;
    const half = buildStair(
      along([
        [0, 0],
        [0, -2],
        [1 + gap, -2],
        [1 + gap, 0],
      ]),
      0,
      2.6,
    );
    const landings = half.steps.filter((s) => s.part === 'landing');
    expect(landings).toHaveLength(1);
    expect(landings[0]!.size[0]).toBeCloseTo(2 + gap);
    // One step more between the landings and it is a flight with a tread again.
    const apart = buildStair(
      along([
        [0, 0],
        [0, -2],
        [1 + D.minGoing + 0.01, -2],
        [1 + D.minGoing + 0.01, 0],
      ]),
      0,
      2.6,
    );
    expect(apart.steps.filter((s) => s.part === 'landing')).toHaveLength(2);
  });
});
