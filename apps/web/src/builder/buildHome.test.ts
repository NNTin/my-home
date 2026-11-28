import { HomeModel, type Dimension } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import mockHomeJson from '../../../../packages/shared/test-fixtures/mock-home.json';
import {
  buildHome,
  clipSpan,
  rotationFor,
  solidPoint,
  splitWall,
  SURFACE_OFFSET,
  type WallSegment,
} from './buildHome';
import type { Vec2 } from '../geom/types';
import {
  defaultVisibility,
  roofIndex,
  showUpTo,
  toggleId,
  visibleScene,
  wholeVisibility,
} from './visibility';

const d = (value: number): Dimension => ({ value, source: 'mock' });
const p = (x: number, z: number) => ({ x: d(x), z: d(z) });
const square = (size: number) => [p(0, 0), p(size, 0), p(size, size), p(0, size)];

/** A 4 m x 4 m single-room building with one wall carrying a door and a window. */
function fixture(): HomeModel {
  return HomeModel.parse({
    schemaVersion: 1,
    id: 'fixture',
    name: 'Fixture',
    building: { id: 'b', name: 'B', footprint: square(4), roofThickness: d(0.2) },
    terrain: {
      groundElevation: d(0),
      bottomElevation: d(-2),
      patches: [
        { id: 't', name: 'Ground', outline: square(10), holes: [square(4)], elevation: d(0) },
      ],
    },
    levels: [
      { id: 'up', name: 'Upper', elevation: d(3), height: d(2.5), slabThickness: d(0.3) },
      { id: 'low', name: 'Lower', elevation: d(-1), height: d(2.5), slabThickness: d(0.2) },
    ],
    apartments: [
      { id: 'a1', name: 'Lower flat', levelIds: ['low'] },
      { id: 'a2', name: 'Upper flat', levelIds: ['up'] },
    ],
    rooms: [{ id: 'r', name: 'Room', levelId: 'low', apartmentId: 'a1', outline: square(4) }],
    walls: [
      {
        id: 'w',
        levelId: 'low',
        apartmentId: 'a1',
        kind: 'exterior',
        start: p(0, 0),
        end: p(4, 0),
        thickness: d(0.3),
        height: d(2.5),
      },
      {
        id: 'w-up',
        levelId: 'up',
        apartmentId: 'a2',
        kind: 'exterior',
        start: p(0, 0),
        end: p(0, 4),
        thickness: d(0.3),
        height: d(2.5),
      },
    ],
    openings: [
      // Listed out of order on purpose: the builder sorts by offset.
      {
        id: 'win',
        name: 'Window',
        typeId: 'window.casement',
        wallId: 'w',
        type: 'window',
        offset: d(2.5),
        width: d(1),
        height: d(1),
        sill: d(1),
      },
      {
        id: 'door',
        name: 'Door',
        typeId: 'door.interior',
        wallId: 'w',
        type: 'door',
        offset: d(0.5),
        width: d(1),
        height: d(2),
        sill: d(0),
      },
    ],
    outdoorAreas: [
      {
        id: 'g',
        name: 'Garden',
        kind: 'garden',
        ownerApartmentId: 'a1',
        outline: square(2),
        elevation: d(0),
      },
    ],
  });
}

/**
 * The fixture under a 45° gable roof with an east-west ridge: knee walls 0.5 m, so the roof
 * underside runs from 3.5 m at z = 0 and z = 4 up to 5.5 m at the ridge (z = 2).
 */
function gableFixture(): HomeModel {
  const model = fixture();
  model.building.roofThickness = d(0.2);
  model.building.roof = {
    type: 'gable',
    ridgeAxis: 'x',
    pitch: d(45),
    kneeWallHeight: d(0.5),
    overhang: d(0.25),
  };
  return HomeModel.parse(model);
}

/** World corners of a trimmed wall segment's outline, on its centre plane. */
const worldOutline = (w: WallSegment) =>
  w.outline!.map((p) => solidPoint({ ...w, depth: w.size[2], outline: w.outline! }, p));

const mockHome = HomeModel.parse(mockHomeJson);

describe('splitWall', () => {
  it('returns one full span for a wall without openings', () => {
    expect(splitWall(4, 2.5, [])).toEqual([{ part: 'full', from: 0, to: 4, bottom: 0, top: 2.5 }]);
  });

  it('cuts a door and a window out of a wall', () => {
    const spans = splitWall(4, 2.5, [
      { offset: 2.5, width: 1, sill: 1, height: 1 },
      { offset: 0.5, width: 1, sill: 0, height: 2 },
    ]);
    expect(spans).toEqual([
      { part: 'full', from: 0, to: 0.5, bottom: 0, top: 2.5 },
      { part: 'above', from: 0.5, to: 1.5, bottom: 2, top: 2.5 },
      { part: 'full', from: 1.5, to: 2.5, bottom: 0, top: 2.5 },
      { part: 'below', from: 2.5, to: 3.5, bottom: 0, top: 1 },
      { part: 'above', from: 2.5, to: 3.5, bottom: 2, top: 2.5 },
      { part: 'full', from: 3.5, to: 4, bottom: 0, top: 2.5 },
    ]);
  });

  it('omits empty spans for full-height openings flush with the wall ends', () => {
    expect(splitWall(1, 2, [{ offset: 0, width: 1, sill: 0, height: 2 }])).toEqual([]);
  });
});

describe('clipSpan', () => {
  const span = { from: 0, to: 4, bottom: 0, top: 1 };

  it('keeps spans below the ceiling and drops spans above it', () => {
    expect(clipSpan(span, () => 2, [])).toBeUndefined();
    expect(clipSpan(span, () => 1, [])).toBeUndefined();
    expect(clipSpan(span, () => 0, [])).toBeNull();
  });

  it('cuts a flat ceiling', () => {
    expect(clipSpan(span, () => 0.5, [])).toEqual([
      [0, 0],
      [4, 0],
      [4, 0.5],
      [0, 0.5],
    ]);
  });

  it('follows a pitched ceiling and its kinks, clamped to the span', () => {
    // A tent peaking at t = 2 (height 1.5), down to 0.5 at both ends: capped at the top of 1.
    const tent = (t: number) => 1.5 - Math.abs(t - 2) * 0.5;
    expect(clipSpan(span, tent, [2])).toEqual([
      [0, 0],
      [4, 0],
      [4, 0.5],
      [3, 1],
      [1, 1],
      [0, 0.5],
    ]);
    // Falling below the bottom drops that part of the span.
    const slope = (t: number) => 2 - t;
    expect(clipSpan(span, slope, [])).toEqual([
      [0, 0],
      [2, 0],
      [1, 1],
      [0, 1],
    ]);
  });
});

describe('rotationFor', () => {
  it('maps local +x onto the wall direction', () => {
    for (const [dx, dz] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const) {
      const a = rotationFor(dx, dz);
      // three.js: rotating (1, 0, 0) about +y by a gives (cos a, 0, -sin a).
      expect(Math.cos(a)).toBeCloseTo(dx);
      expect(-Math.sin(a)).toBeCloseTo(dz);
    }
  });
});

describe('buildHome', () => {
  const scene = buildHome(fixture());

  it('orders levels by elevation', () => {
    expect(scene.levels.map((l) => [l.id, l.index])).toEqual([
      ['low', 0],
      ['up', 1],
    ]);
  });

  it('places wall segments in world space on the level floor', () => {
    const segments = scene.walls.filter((w) => w.wallId === 'w');
    expect(segments.map((s) => s.id)).toEqual([
      'w:0:full',
      'w:1:above',
      'w:2:full',
      'w:3:below',
      'w:4:above',
      'w:5:full',
    ]);
    const [first, lintel] = segments;
    expect(first).toMatchObject({
      levelId: 'low',
      apartmentId: 'a1',
      kind: 'exterior',
      rotationY: -0,
    });
    expect(first!.center).toEqual([0.25, 0.25, 0]); // floor at -1, 2.5 m high
    expect(first!.size).toEqual([0.5, 2.5, 0.3]);
    expect(lintel!.center).toEqual([1, 1.25, 0]);
    expect(lintel!.size).toEqual([1, 0.5, 0.3]);
  });

  it('rotates segments of walls that run along z', () => {
    const [segment] = scene.walls.filter((w) => w.wallId === 'w-up');
    expect(segment!.rotationY).toBeCloseTo(-Math.PI / 2);
    expect(segment!.center).toEqual([0, 4.25, 2]);
    expect(segment!.size).toEqual([4, 2.5, 0.3]);
  });

  it('describes openings for frames and glass', () => {
    expect(scene.openings).toEqual([
      expect.objectContaining({
        id: 'win',
        type: 'window',
        center: [3, 0.5, 0],
        size: [1, 1, 0.3],
      }),
      expect.objectContaining({ id: 'door', type: 'door', center: [1, 0, 0], size: [1, 2, 0.3] }),
    ]);
  });

  it('adds a floor slab per level and a roof on the top level', () => {
    expect(scene.slabs.map((s) => [s.id, s.levelId, s.bottom, s.top])).toEqual([
      ['up:floor', 'up', 2.7, 3],
      ['low:floor', 'low', -1.2, -1],
      ['roof', 'up', 5.5, 5.7 + SURFACE_OFFSET],
    ]);
    expect(scene.slabs[0]!.outline).toEqual([
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ]);
  });

  it('builds room floors, terrain and outdoor areas', () => {
    expect(scene.roomFloors).toEqual([
      expect.objectContaining({ roomId: 'r', levelId: 'low', y: -1 + SURFACE_OFFSET }),
    ]);
    expect(scene.terrain).toEqual([
      expect.objectContaining({ id: 't', bottom: -2, top: 0, holes: [expect.any(Array)] }),
    ]);
    expect(scene.outdoorAreas).toEqual([
      expect.objectContaining({
        id: 'g',
        kind: 'garden',
        ownerApartmentId: 'a1',
        y: SURFACE_OFFSET,
      }),
    ]);
    expect(scene.bounds).toEqual({ min: [0, -1.2, 0], max: [10, 5.7 + SURFACE_OFFSET, 10] });
  });

  it('builds the mock home with every apartment, both gardens and the driveway', () => {
    const mock = buildHome(mockHome);
    expect(mock.levels.map((l) => l.id)).toEqual(['souterrain', 'ground-floor', 'first-floor']);
    expect(mock.apartments).toHaveLength(3);
    expect(new Set(mock.walls.map((w) => w.apartmentId))).toEqual(
      new Set(mock.apartments.map((a) => a.id)),
    );
    expect(mock.outdoorAreas.map((a) => a.id)).toEqual([
      'garden-souterrain',
      'garden-ground-floor',
      'driveway',
    ]);
    expect(mock.openings).toHaveLength(mockHome.openings.length);
    const souterrainFloor = mock.slabs.find((s) => s.id === 'souterrain:floor')!;
    expect(souterrainFloor.top).toBeLessThan(0);
  });

  it('puts a gable roof on the mock home, with the first floor as its attic', () => {
    const mock = buildHome(mockHome);
    expect(mock.slabs.some((s) => s.kind === 'roof')).toBe(false);
    expect(mock.roofPlanes.map((r) => r.levelId)).toEqual(['first-floor', 'first-floor']);
    // Gable ends are trimmed into gables; the knee walls are trimmed flat.
    const trimmed = (wallId: string) =>
      mock.walls.filter((w) => w.wallId === wallId && w.outline).map(worldOutline);
    const ridge = 4.4 + 1 + 4 * Math.tan((40 * Math.PI) / 180);
    const westTop = Math.max(
      ...trimmed('first-floor-wall-west')
        .flat()
        .map((p) => p[1]),
    );
    expect(westTop).toBeCloseTo(ridge);
    expect(trimmed('first-floor-wall-front')).toHaveLength(1);
    expect(mock.bounds.max[1]).toBeGreaterThan(ridge);
    // The attic floor stays where furniture is placed.
    expect(mock.levels[2]!.elevation).toBe(4.4);
  });
});

describe('gable roof', () => {
  const scene = buildHome(gableFixture());
  const close = (actual: number[], expected: number[]) =>
    actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!));

  it('replaces the flat roof slab with two sloped planes', () => {
    expect(scene.slabs.map((s) => s.kind)).toEqual(['floor', 'floor']);
    expect(scene.roofPlanes.map((r) => [r.id, r.levelId])).toEqual([
      ['roof:min', 'up'],
      ['roof:max', 'up'],
    ]);
  });

  it('runs the planes from the ridge down past the eaves and gables by the overhang', () => {
    const plane = scene.roofPlanes[1]!;
    const [ridge, eave, eaveTop] = plane.outline as [Vec2, Vec2, Vec2, Vec2];
    // Ridge above the footprint centre line, 2 m above the eaves at 45°.
    close(solidPoint(plane, ridge), [2, 5.5, 2]);
    // South eave 0.25 m past the footprint and 0.25 m lower.
    close(solidPoint(plane, eave), [2, 3.25, 4.25]);
    // 0.2 m thick at right angles to the slope.
    expect(eaveTop[1] - eave[1]).toBeCloseTo(0.2 * Math.SQRT2);
    // Along the ridge from x = -0.25 to 4.25.
    close(solidPoint(plane, ridge, -plane.depth / 2), [4.25, 5.5, 2]);
    close(solidPoint(plane, ridge, plane.depth / 2), [-0.25, 5.5, 2]);
    const north = scene.roofPlanes[0]!;
    close(solidPoint(north, north.outline[1]!), [2, 3.25, -0.25]);
  });

  it('trims a gable-end wall on the attic to the roof underside', () => {
    const [segment] = scene.walls.filter((w) => w.wallId === 'w-up');
    // The 2.5 m wall runs across the ridge, so it becomes a gable: knee height at both ends.
    const round = (n: number) => Math.round(n * 1e9) / 1e9 + 0;
    expect(worldOutline(segment!).map((p) => p.map(round))).toEqual([
      [0, 3, 0],
      [0, 3, 4],
      [0, 3.5, 4],
      [0, 5.5, 2],
      [0, 3.5, 0],
    ]);
  });

  it('leaves walls on lower levels alone', () => {
    expect(scene.walls.filter((w) => w.levelId === 'low').every((w) => !w.outline)).toBe(true);
  });

  it('includes the roof in the bounds', () => {
    expect(scene.bounds.max[1]).toBeCloseTo(5.5 + 0.2 * Math.SQRT2);
  });
});

describe('visibleScene', () => {
  const scene = buildHome(fixture());

  it('starts in the lowest level with the levels above unchecked', () => {
    const v = defaultVisibility(scene);
    const [low, ...above] = scene.levels;
    expect(v.maxLevelIndex).toBe(low!.index);
    expect(v.hiddenLevels).toEqual(above.map((l) => l.id));
    expect(visibleScene(scene, v).walls.every((w) => w.levelId === low!.id)).toBe(true);
    expect(visibleScene(scene, v).slabs.some((s) => s.kind === 'roof')).toBe(false);
  });

  it('showUpTo cuts above a level and checks the levels up to it', () => {
    const top = scene.levels.at(-1)!;
    const v = showUpTo(scene, defaultVisibility(scene), top.index);
    expect(v.maxLevelIndex).toBe(top.index);
    expect(v.hiddenLevels).toEqual([]);
    expect(showUpTo(scene, defaultVisibility(scene), scene.levels[0]!.index)).toEqual(
      defaultVisibility(scene),
    );
  });

  it('shows everything when whole', () => {
    // All but the tops of the walls, which are cut faces: nothing is cut in the whole house.
    expect(visibleScene(scene, wholeVisibility(scene))).toEqual({
      ...scene,
      wallFaces: scene.wallFaces.filter((f) => f.part !== 'top'),
    });
    expect(scene.wallFaces.some((f) => f.part === 'top')).toBe(true);
  });

  it('shows the roof only above the top level, so the top level can be looked into', () => {
    const flat = visibleScene(scene, { ...wholeVisibility(scene), maxLevelIndex: 1 });
    expect(roofIndex(scene)).toBe(2);
    expect(flat.slabs.map((s) => s.id)).toEqual(['up:floor', 'low:floor']);

    const gable = buildHome(gableFixture());
    expect(visibleScene(gable, wholeVisibility(gable)).roofPlanes).toHaveLength(2);
    const attic = visibleScene(gable, { ...wholeVisibility(gable), maxLevelIndex: 1 });
    expect(attic.roofPlanes).toEqual([]);
    expect(attic.walls.some((w) => w.wallId === 'w-up')).toBe(true);
    const hidden = visibleScene(gable, { ...wholeVisibility(gable), hiddenLevels: ['up'] });
    expect(hidden.roofPlanes).toEqual([]);
  });

  it('cuts away levels above the selected one, including their slabs and roof', () => {
    const v = { ...wholeVisibility(scene), maxLevelIndex: 0 };
    const shown = visibleScene(scene, v);
    expect(new Set(shown.walls.map((w) => w.levelId))).toEqual(new Set(['low']));
    expect(shown.slabs.map((s) => s.id)).toEqual(['low:floor']);
    expect(shown.roomFloors).toHaveLength(1);
  });

  it('hides individual levels, apartments, outdoor areas and the terrain', () => {
    const base = wholeVisibility(scene);
    expect(visibleScene(scene, { ...base, hiddenLevels: ['low'] }).roomFloors).toEqual([]);
    const noFlat = visibleScene(scene, { ...base, hiddenApartments: ['a1'] });
    expect(noFlat.walls.every((w) => w.apartmentId === 'a2')).toBe(true);
    expect(noFlat.openings).toEqual([]);
    expect(noFlat.slabs).toHaveLength(3); // slabs belong to levels, not apartments
    expect(visibleScene(scene, { ...base, hiddenOutdoorAreas: ['g'] }).outdoorAreas).toEqual([]);
    expect(visibleScene(scene, { ...base, showTerrain: false }).terrain).toEqual([]);
  });

  it('toggles ids', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
  });
});
