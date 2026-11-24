import { HomeModel, resolveFinish, wallLength } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import realHomeJson from '../../../../data/homes/home.json';
import mockHomeJson from '../../../../packages/shared/test-fixtures/mock-home.json';
import { shapeGeometry } from '../scene/batches';
import { buildHome, type Vec2, type Vec3, type WallFace } from './buildHome';
import { groupShown, shellItems } from './drawList';
import { defaultVisibility, visibleScene, wholeVisibility } from './visibility';
import { faceRegions, wallFaceShapes, type WallCut, type WallFacesInput } from './wallFaces';

// Walls drawn face by face (docs/design/realistic-render.md §8.1): one polygon per face, so a
// wall with openings has no seams.

const realModel = HomeModel.parse(structuredClone(realHomeJson));
const home = buildHome(realModel);
const mock = buildHome(HomeModel.parse(structuredClone(mockHomeJson)));

const paint = resolveFinish(undefined, { finish: 'paint.plain' });
const facade = resolveFinish(undefined, { finish: 'render.facade' });
const dark = resolveFinish(undefined, { finish: 'cut.dark' });

const area = (p: readonly (readonly number[])[]) =>
  Math.abs(
    p.reduce((sum, [x, y], i) => {
      const [nx, ny] = p[(i + 1) % p.length]!;
      return sum + x! * ny! - nx! * y!;
    }, 0),
  ) / 2;
/** The area of a face polygon in the wall's (x, y): its outline without its holes. */
const faceArea = (f: { outline: Vec3[]; holes: Vec3[][] }) =>
  area(f.outline) - f.holes.reduce((sum, h) => sum + area(h), 0);

const cut = (id: string, from: number, to: number, bottom: number, top: number): WallCut => ({
  id,
  from,
  to,
  bottom,
  top,
});

const wall = (over: Partial<WallFacesInput> = {}): WallFacesInput => ({
  length: 4,
  height: 2.5,
  thickness: 0.24,
  cuts: [],
  chain: [
    [0, 2.5],
    [4, 2.5],
  ],
  runs: {
    1: [{ from: 0, to: 4, roomId: 'a', finish: paint }],
    [-1]: [{ from: 0, to: 4, finish: facade }],
  } as WallFacesInput['runs'],
  ends: [{}, {}],
  finish: facade,
  cutFinish: dark,
  ...over,
});

describe('a wall face without its openings', () => {
  it('is one rectangle when nothing is cut out', () => {
    expect(faceRegions(1, 3, 2.5, [])).toEqual([
      {
        outline: [
          [1, 0],
          [3, 0],
          [3, 2.5],
          [1, 2.5],
        ],
        holes: [],
      },
    ]);
  });

  it('has a window as a hole: one polygon, no stretch beside, under or over it', () => {
    const [region, ...rest] = faceRegions(0, 4, 2.5, [cut('w', 1, 2, 0.9, 2.1)]);
    expect(rest).toEqual([]);
    expect(region!.outline).toHaveLength(4);
    expect(region!.holes).toHaveLength(1);
    expect(new Set(region!.holes[0]!.map((p) => p.join()))).toEqual(
      new Set(['1,0.9', '2,0.9', '2,2.1', '1,2.1']),
    );
    expect(area(region!.outline) - area(region!.holes[0]!)).toBeCloseTo(4 * 2.5 - 1.2, 9);
  });

  it('has a door as a notch in its outline, not as a hole on its edge', () => {
    const [region, ...rest] = faceRegions(0, 4, 2.5, [cut('d', 1, 1.8, 0, 2)]);
    expect(rest).toEqual([]);
    expect(region!.holes).toEqual([]);
    expect(region!.outline).toHaveLength(8);
    expect(area(region!.outline)).toBeCloseTo(4 * 2.5 - 0.8 * 2, 9);
    // Anticlockwise, like every outline.
    const signed = region!.outline.reduce((sum, [x, y], i, all) => {
      const [nx, ny] = all[(i + 1) % all.length]!;
      return sum + x * ny - nx * y;
    }, 0);
    expect(signed).toBeGreaterThan(0);
  });

  it('takes several openings at once, and one that reaches past the stretch', () => {
    const cuts = [cut('d', 0.5, 1.3, 0, 2), cut('w', 2, 3, 1, 2), cut('edge', 3.6, 5, 1, 2)];
    const [region, ...rest] = faceRegions(0, 4, 2.5, cuts);
    expect(rest).toEqual([]);
    expect(region!.holes).toHaveLength(1);
    expect(area(region!.outline) - area(region!.holes[0]!)).toBeCloseTo(10 - 1.6 - 1 - 0.4, 9);
  });

  it('is two polygons beside an opening from floor to top', () => {
    const regions = faceRegions(0, 4, 2.5, [cut('gap', 1, 2, 0, 2.5)]);
    expect(regions).toHaveLength(2);
    expect(regions.map((r) => area(r.outline)).sort()).toEqual([2.5, 5]);
  });
});

describe('the faces of one wall', () => {
  it('are its two long faces, its top and its ends: flat polygons in one frame', () => {
    const faces = wallFaceShapes(wall());
    expect(faces.map((f) => f.id)).toEqual(['front-0', 'back-0', 'top-0', 'start', 'end']);
    const [front, back, top, start, end] = faces;
    expect(front).toMatchObject({ part: 'front', roomId: 'a', finish: paint });
    expect(back).toMatchObject({ part: 'back', finish: facade });
    expect(back!.roomId).toBeUndefined();
    expect(top).toMatchObject({ part: 'top', finish: dark });
    expect(front!.outline.every((p) => p[2] === 0.12)).toBe(true);
    expect(back!.outline.every((p) => p[2] === -0.12)).toBe(true);
    expect(top!.outline.every((p) => p[1] === 2.5)).toBe(true);
    expect(start!.outline.every((p) => p[0] === 0)).toBe(true);
    expect(end!.outline.every((p) => p[0] === 4)).toBe(true);
  });

  it('every face is drawn from outside: its triangles look away from the wall', () => {
    const faces = wallFaceShapes(
      wall({ cuts: [cut('w', 1, 2, 0.9, 2.1), cut('d', 2.6, 3.4, 0, 2)] }),
    );
    const inside: Vec3 = [0.3, 1.2, 0];
    for (const f of faces) {
      const g = shapeGeometry({ kind: 'polygon', outline: f.outline, holes: f.holes });
      const normal = g.getAttribute('normal');
      const [x, y, z] = f.outline[0]!;
      // A reveal looks into its opening, away from the solid wall beside it.
      const from: Vec3 = f.part === 'reveal' ? [f.id.includes('w:') ? 1.5 : 3, 1.5, 0] : inside;
      const away =
        (x - from[0]) * normal.getX(0) + (y - from[1]) * normal.getY(0) + z * normal.getZ(0);
      expect(f.part === 'reveal' ? -away : away, f.id).toBeGreaterThan(0);
      expect(g.index!.count, f.id).toBeGreaterThanOrEqual(6);
    }
  });

  it('a reveal is in two halves, each with the finish of the long face it meets', () => {
    const faces = wallFaceShapes(wall({ cuts: [cut('w', 1, 2, 0.9, 2.1)] }));
    const reveals = faces.filter((f) => f.part === 'reveal');
    expect(reveals.map((f) => f.id)).toEqual([
      'reveal:w:left-front',
      'reveal:w:right-front',
      'reveal:w:head-front',
      'reveal:w:sill-front',
      'reveal:w:left-back',
      'reveal:w:right-back',
      'reveal:w:head-back',
      'reveal:w:sill-back',
    ]);
    for (const f of reveals) {
      const front = f.id.endsWith('-front');
      expect(f.finish).toBe(front ? paint : facade);
      expect(f.openingId).toBe('w');
      const zs = f.outline.map((p) => p[2]);
      // From the long face to the middle of the wall, where the frame stands.
      expect([Math.min(...zs), Math.max(...zs)]).toEqual(front ? [0, 0.12] : [-0.12, 0]);
    }
    // A door has no sill: its reveal is the two jambs and the head.
    const door = wallFaceShapes(wall({ cuts: [cut('d', 1, 1.8, 0, 2)] }));
    expect(door.filter((f) => f.part === 'reveal').map((f) => f.id.split(':')[2])).toEqual([
      'left-front',
      'right-front',
      'head-front',
      'left-back',
      'right-back',
      'head-back',
    ]);
  });

  it('no edge ends in the middle of another: a corner of one face is a corner of its neighbours', () => {
    const faces = wallFaceShapes(
      wall({
        cuts: [cut('w', 1, 2, 0.9, 2.1), cut('d', 2.6, 3.4, 0, 2)],
        runs: {
          1: [
            { from: 0, to: 2.3, roomId: 'a', finish: paint },
            { from: 2.3, to: 4, roomId: 'b', finish: paint },
          ],
          [-1]: [{ from: 0, to: 4, finish: facade }],
        } as WallFacesInput['runs'],
      }),
    );
    const key = (p: Vec3) => p.join();
    const corners = (f: (typeof faces)[number]) => [f.outline, ...f.holes].flat();
    const long = faces.filter((f) => f.part === 'front' || f.part === 'back');
    const longCorners = new Set(long.flatMap(corners).map(key));
    // Every corner of a reveal, a top or an end that lies in a long face's plane is a corner there.
    for (const f of faces.filter((x) => x.part !== 'front' && x.part !== 'back')) {
      for (const p of corners(f).filter((q) => Math.abs(q[2]) === 0.12)) {
        expect(longCorners.has(key(p)), `${f.id} ${key(p)}`).toBe(true);
      }
    }
    // And the other way round, along the top: where two rooms meet, the top has a vertex.
    const top = faces.find((f) => f.part === 'top')!;
    expect(top.outline.map(key)).toContain('2.3,2.5,0.12');
    expect(top.outline.map(key)).not.toContain('2.3,2.5,-0.12');
  });

  it('an end inside another wall is not drawn; one that looks into a room takes its finish', () => {
    const faces = wallFaceShapes(
      wall({ ends: [{ covered: true }, { roomId: 'b', finish: paint }] }),
    );
    expect(faces.find((f) => f.id === 'start')).toBeUndefined();
    expect(faces.find((f) => f.id === 'end')).toMatchObject({ roomId: 'b', finish: paint });
  });

  it('under a pitched roof the long faces and the top follow the roof', () => {
    // A gable end: the roof rises to the middle of the wall and falls again.
    const chain: Vec2[] = [
      [0, 1],
      [2, 2.5],
      [4, 1],
    ];
    const faces = wallFaceShapes(wall({ height: 3, chain, cuts: [cut('w', 1.6, 2.4, 0.8, 1.6)] }));
    const front = faces.find((f) => f.id === 'front-0')!;
    expect(faceArea(front)).toBeCloseTo(4 * 1 + (4 * 1.5) / 2 - 0.8 * 0.8, 6);
    const tops = faces.filter((f) => f.part === 'top');
    expect(tops).toHaveLength(2);
    expect(tops[0]!.outline.map((p) => p[1])).toEqual([1, 2.5, 2.5, 1]);
    // The ends are as high as the roof is there.
    expect(Math.max(...faces.find((f) => f.id === 'start')!.outline.map((p) => p[1]))).toBe(1);
  });
});

describe('the wall faces of a home', () => {
  const long = (f: WallFace) => f.part === 'front' || f.part === 'back';

  it.each([
    ['home', realModel, home],
    ['mock-home', HomeModel.parse(structuredClone(mockHomeJson)), mock],
  ] as const)(
    'in %s the faces stand where the model has its walls: start, direction, length, height, thickness',
    (_name, model, scene) => {
      for (const w of model.walls) {
        const faces = scene.wallFaces.filter((f) => f.wallId === w.id);
        const base = model.levels.find((l) => l.id === w.levelId)!.elevation.value;
        const length = wallLength(w);
        expect(faces.length, w.id).toBeGreaterThanOrEqual(2);
        for (const f of faces) {
          expect(f.center).toEqual([w.start.x.value, base, w.start.z.value]);
          expect(f.rotationY).toBe(
            Math.atan2(-(w.end.z.value - w.start.z.value), w.end.x.value - w.start.x.value),
          );
          for (const [x, y, z] of [f.outline, ...f.holes].flat()) {
            expect(x, f.id).toBeGreaterThanOrEqual(-1e-9);
            expect(x, f.id).toBeLessThanOrEqual(length + 1e-9);
            expect(y, f.id).toBeGreaterThanOrEqual(-1e-9);
            expect(y, f.id).toBeLessThanOrEqual(w.height.value + 1e-9);
            expect(Math.abs(z), f.id).toBeLessThanOrEqual(w.thickness.value / 2);
          }
        }
        for (const f of faces.filter(long)) {
          const z = (f.part === 'front' ? 1 : -1) * (w.thickness.value / 2);
          expect(
            f.outline.every((p) => p[2] === z),
            f.id,
          ).toBe(true);
        }
      }
    },
  );

  it('a long face is the wall’s rectangle without its openings, whatever rooms it borders', () => {
    // The walls of the two lower levels: none is trimmed by the roof.
    for (const w of realModel.walls.filter((x) => x.levelId !== 'first-floor')) {
      const openings = realModel.openings.filter((o) => o.wallId === w.id);
      const open = openings.reduce((sum, o) => sum + o.width.value * o.height.value, 0);
      for (const part of ['front', 'back'] as const) {
        const faces = home.wallFaces.filter((f) => f.wallId === w.id && f.part === part);
        const drawn = faces.reduce((sum, f) => sum + faceArea(f), 0);
        expect(drawn, `${w.id} ${part}`).toBeCloseTo(wallLength(w) * w.height.value - open, 6);
        // A window is a hole, a door a notch: never a stretch of its own.
        const windows = openings.filter((o) => o.sill.value > 0).length;
        expect(
          faces.reduce((n, f) => n + f.holes.length, 0),
          `${w.id} ${part}`,
        ).toBe(windows);
      }
    }
  });

  it('where two walls go on in one line, no end face stands between them', () => {
    // The corridor's north wall is two walls of the model, end to end.
    const a = home.wallFaces.filter((f) => f.wallId === 'souterrain-wall-work-room-corridor');
    const b = home.wallFaces.filter((f) => f.wallId === 'souterrain-wall-bath-room-corridor');
    expect(a.some((f) => f.part === 'end')).toBe(false);
    expect(b.filter((f) => f.part === 'end').map((f) => f.id)).toEqual([
      'souterrain-wall-bath-room-corridor/end',
    ]);
    // That one end stands free in the corridor, towards the kitchen, and is drawn like its walls.
    expect(b.find((f) => f.part === 'end')).toMatchObject({
      roomId: 'souterrain-corridor',
      finish: { finish: 'plaster.fine' },
    });
  });

  it('a wall is drawn as flat polygons, none a closed solid; its solid stretches are not drawn', () => {
    const items = shellItems(home);
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const f of home.wallFaces) {
      const item = byId.get(f.id)!;
      expect(item.shape, f.id).toEqual({ kind: 'polygon', outline: f.outline, holes: f.holes });
      expect(item, f.id).toMatchObject({
        closed: false,
        castShadow: true,
        receiveShadow: true,
        finish: f.finish.finish,
        tint: f.finish.tint,
        uv: f.uv,
      });
      expect(item.group.kind, f.id).toBe(f.part === 'top' ? 'cut' : 'level');
    }
    for (const w of home.walls) expect(byId.has(w.id), w.id).toBe(false);
  });

  it('the top of a wall is a cut face: dark, and drawn only while nothing stands on it', () => {
    const tops = home.wallFaces.filter((f) => f.part === 'top');
    expect(tops.length).toBeGreaterThanOrEqual(realModel.walls.length);
    for (const f of tops) expect(f.finish.finish).toBe('cut.dark');
    const whole = wholeVisibility(home);
    const cutaway = defaultVisibility(home);
    const group = (levelId: string) => ({ kind: 'cut' as const, levelId });
    // The first view looks into the souterrain: its wall tops show.
    expect(groupShown(group('souterrain'), home, cutaway)).toBe(true);
    expect(groupShown(group('ground-floor'), home, cutaway)).toBe(false);
    // The closed house: every top is under the level above or the roof.
    for (const level of home.levels) expect(groupShown(group(level.id), home, whole)).toBe(false);
    // Without the roof the attic's walls end in cut faces.
    const open = { ...whole, maxLevelIndex: home.levels.length - 1 };
    expect(groupShown(group('first-floor'), home, open)).toBe(true);
    expect(groupShown(group('ground-floor'), home, open)).toBe(false);
    // The descriptors of a visibility follow the same rule.
    const parts = (v: typeof whole) => new Set(visibleScene(home, v).wallFaces.map((f) => f.part));
    expect(parts(whole).has('top')).toBe(false);
    expect(parts(cutaway).has('top')).toBe(true);
  });
});
