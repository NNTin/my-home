import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  describeIssues,
  formatIssues,
  formatPath,
  HomeModel,
  homeModelJsonSchema,
  northBearingOf,
  roofOf,
  type ValidationIssue,
} from './home-model';
import { ListHomesQuery } from './homes';

const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

const mockHome = () => structuredClone(readJson('../../../data/homes/mock-home.json')) as HomeModel;
const realHome = () => structuredClone(readJson('../../../data/homes/home.json')) as HomeModel;

const d = (value: number) => ({ value, source: 'mock' as const });

const issuesOf = (input: unknown): ValidationIssue[] => {
  const result = HomeModel.safeParse(input);
  if (result.success) throw new Error('expected the model to be invalid');
  return formatIssues(result.error);
};

describe('HomeModel', () => {
  it('accepts the mock home', () => {
    const result = HomeModel.safeParse(mockHome());
    expect(result.error && describeIssues(formatIssues(result.error))).toBeUndefined();
  });

  it('contains all apartments, gardens and the driveway in the mock home', () => {
    const home = HomeModel.parse(mockHome());
    expect(home.levels.map((l) => l.id)).toEqual(['souterrain', 'ground-floor', 'first-floor']);
    expect(home.apartments).toHaveLength(3);
    expect(home.outdoorAreas.map((a) => a.kind).sort()).toEqual(['driveway', 'garden', 'garden']);
    const souterrain = home.levels.find((l) => l.id === 'souterrain');
    expect(souterrain?.elevation.value).toBeLessThan(home.terrain.groundElevation.value);
    // Partially sunken: the souterrain's walls reach above ground level.
    expect(souterrain!.elevation.value + souterrain!.height.value).toBeGreaterThan(0);
  });

  it('models the first floor as an attic under a gable roof, with north at -z', () => {
    const home = HomeModel.parse(mockHome());
    expect(roofOf(home.building)).toMatchObject({ type: 'gable', ridgeAxis: 'x' });
    expect(northBearingOf(home.building)).toBe(0);
    expect(home.walls.some((w) => w.levelId === 'second-floor')).toBe(false);
  });

  it('still accepts schema-1 documents without a roof or north bearing (4 levels, flat roof)', () => {
    // The shape stored before the attic change: no roof/northBearing and a second floor.
    const home = mockHome();
    delete home.building.roof;
    delete home.building.northBearing;
    const first = home.levels.find((l) => l.id === 'first-floor')!;
    home.levels.push({
      ...structuredClone(first),
      id: 'second-floor',
      name: 'Second floor',
      elevation: { value: 7.25, source: 'mock' },
    });
    home.apartments.push({ id: 'apt-second-floor', name: 'Second', levelIds: ['second-floor'] });
    for (const w of home.walls.filter((w) => w.levelId === 'first-floor')) {
      home.walls.push({
        ...structuredClone(w),
        id: w.id.replace('first', 'second'),
        levelId: 'second-floor',
        apartmentId: 'apt-second-floor',
        height: { value: 2.9, source: 'mock' },
      });
    }
    const parsed = HomeModel.parse(home);
    expect(parsed.levels).toHaveLength(4);
    expect(roofOf(parsed.building)).toEqual({ type: 'flat' });
    expect(northBearingOf(parsed.building)).toBe(0);
  });

  it('rejects an invalid roof or bearing', () => {
    const home = mockHome();
    const roof = home.building.roof as Extract<HomeModel['building']['roof'], { type: 'gable' }>;
    roof.pitch.value = 90;
    home.building.northBearing!.value = 400;
    const paths = issuesOf(home).map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining(['building.roof.pitch.value', 'building.northBearing.value']),
    );
    const other = mockHome() as unknown as { building: { roof: unknown } };
    other.building.roof = { type: 'dome' };
    expect(issuesOf(other).map((i) => i.path)).toContain('building.roof.type');
  });

  it.each([
    ['mock', mockHome],
    ['real', realHome],
  ])('carries a source on every number in the %s home', (_, load) => {
    const offenders: string[] = [];
    // Edge indexes are references, not measurements.
    const isIndex = (path: (string | number)[]) =>
      path.at(-1) === 'edge' || path.at(-2) === 'openEdges';
    const walk = (value: unknown, path: (string | number)[]) => {
      if (Array.isArray(value)) return value.forEach((v, i) => walk(v, [...path, i]));
      if (typeof value === 'number' && formatPath(path) !== 'schemaVersion' && !isIndex(path)) {
        const parentIsDimension = path.at(-1) === 'value';
        if (!parentIsDimension) offenders.push(formatPath(path));
      }
      if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        if ('value' in obj && !('source' in obj)) offenders.push(formatPath(path));
        for (const [k, v] of Object.entries(obj)) walk(v, [...path, k]);
      }
    };
    walk(load(), []);
    expect(offenders).toEqual([]);
  });

  it('rejects dangling references with their paths', () => {
    const home = mockHome();
    home.openings[0]!.wallId = 'no-such-wall';
    home.rooms[0]!.levelId = 'no-such-level';
    home.outdoorAreas[0]!.ownerApartmentId = 'no-such-apartment';
    expect(issuesOf(home)).toEqual(
      expect.arrayContaining([
        { path: 'openings[0].wallId', message: 'Unknown wall "no-such-wall"' },
        { path: 'rooms[0].levelId', message: 'Unknown level "no-such-level"' },
        {
          path: 'outdoorAreas[0].ownerApartmentId',
          message: 'Unknown apartment "no-such-apartment"',
        },
      ]),
    );
  });

  it('rejects an opening wider than its wall', () => {
    const home = mockHome();
    home.openings.push({
      ...home.openings[0]!,
      id: 'too-wide',
      wallId: 'souterrain-wall-kitchen-bathroom',
      offset: { value: 0, source: 'mock' },
      width: { value: 5, source: 'mock' },
    });
    const issues = issuesOf(home);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe(`openings[${home.openings.length - 1}].width`);
    expect(issues[0]!.message).toMatch(/spans 0 m to 5 m but wall .* is only 3.35 m long/);
  });

  it('rejects openings that are too tall or overlap', () => {
    const home = mockHome();
    home.openings[0]!.height.value = 10;
    home.openings[1]!.offset.value = home.openings[0]!.offset.value;
    const paths = issuesOf(home).map((i) => i.path);
    expect(paths).toEqual(['openings[0].height', 'openings[1].offset']);
  });

  it('rejects duplicate ids across collections', () => {
    const home = mockHome();
    home.walls[1]!.id = home.walls[0]!.id;
    home.rooms[0]!.id = home.levels[0]!.id;
    const issues = issuesOf(home);
    expect(issues).toContainEqual({
      path: 'rooms[0].id',
      message: 'Duplicate id "souterrain" (already used by levels[0])',
    });
    expect(issues.map((i) => i.path)).toContain('walls[1].id');
  });

  it('rejects shape errors such as a missing source, unknown keys or a negative width', () => {
    const home = mockHome() as unknown as Record<string, unknown> & HomeModel;
    delete (home.levels[0]!.height as Partial<HomeModel['levels'][0]['height']>).source;
    home.openings[0]!.width.value = -1;
    home.typo = true;
    const paths = issuesOf(home).map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining(['', 'levels[0].height.source', 'openings[0].width.value']),
    );
  });
});

describe('the real home', () => {
  const home = () => HomeModel.parse(realHome());
  const level = (id: string) => home().levels.find((l) => l.id === id)!;
  const patch = (id: string) => home().terrain.patches.find((p) => p.id === id)!;
  /** Absolute height of an opening's sill or head. */
  const opening = (id: string) => {
    const model = home();
    const o = model.openings.find((x) => x.id === id)!;
    const wall = model.walls.find((w) => w.id === o.wallId)!;
    const floor = model.levels.find((l) => l.id === wall.levelId)!.elevation.value;
    return { sill: floor + o.sill.value, head: floor + o.sill.value + o.height.value };
  };

  it('is valid', () => {
    const result = HomeModel.safeParse(realHome());
    expect(result.error && describeIssues(formatIssues(result.error))).toBeUndefined();
  });

  it('has a souterrain, a ground floor at the datum and an attic under a gable roof', () => {
    expect(home().levels.map((l) => l.id)).toEqual(['souterrain', 'ground-floor', 'first-floor']);
    expect(level('ground-floor').elevation.value).toBe(0);
    expect(roofOf(home().building)).toMatchObject({ type: 'gable', ridgeAxis: 'x' });
    expect(northBearingOf(home().building)).toBeCloseTo(2.5);
  });

  it('puts the north souterrain windows just above the lawn and the south one below grade', () => {
    const lawn = patch('terrain-lower').elevation.value;
    for (const id of ['1', '2', '3']) {
      const { sill } = opening(`souterrain-window-north-${id}`);
      expect(sill).toBeGreaterThan(lawn);
      expect(sill - lawn).toBeLessThan(0.3);
    }
    const south = opening('souterrain-window-south');
    expect(south.head).toBeLessThan(patch('terrain-south').elevation.value);
    expect(south.sill).toBeGreaterThan(patch('terrain-light-well').elevation.value);
  });

  it('has a garage, a sloped entrance down to the patio and two gardens on their own levels', () => {
    const model = home();
    expect(model.outbuildings?.map((b) => b.kind)).toEqual(['garage', 'porch']);
    const slope = patch('terrain-entrance-slope');
    expect(slope.elevation.value).toBe(patch('terrain-south').elevation.value);
    expect(slope.slope?.lowElevation.value).toBe(patch('terrain-lower').elevation.value);
    const gardens = model.outdoorAreas.filter((a) => a.kind === 'garden');
    expect(gardens.map((g) => [g.ownerApartmentId, g.elevation.value])).toEqual([
      ['apt-ground-floor', patch('terrain-south').elevation.value],
      ['apt-souterrain', patch('terrain-lower').elevation.value],
    ]);
  });
});

describe('optional structures', () => {
  /** Index and element of the entry with `id` (paths in issues use indexes). */
  const byId = <T extends { id: string }>(list: T[], id: string) => {
    const index = list.findIndex((e) => e.id === id);
    if (index < 0) throw new Error(`no fixture "${id}"`);
    return [index, list[index]!] as const;
  };

  it('rejects slopes that do not fall or reach below the terrain bottom', () => {
    const home = realHome();
    const [slopeAt, slope] = byId(home.terrain.patches, 'terrain-entrance-slope');
    const [laneAt, lane] = byId(home.terrain.patches, 'terrain-lane');
    const [pathAt, path] = byId(home.outdoorAreas, 'entrance-souterrain');
    slope.slope!.lowElevation.value = 1;
    lane.slope!.lowElevation.value = -10;
    path.slope!.lowElevation.value = 5;
    expect(issuesOf(home).map((i) => i.path)).toEqual([
      `terrain.patches[${slopeAt}].slope.lowElevation`,
      `terrain.patches[${laneAt}].elevation`,
      `outdoorAreas[${pathAt}].slope.lowElevation`,
    ]);
  });

  it('rejects outbuilding openings that do not fit, unknown edges and openings on open edges', () => {
    const home = realHome();
    const [at, garage] = byId(home.outbuildings!, 'garage');
    const [doorAt, door] = byId(garage.openings!, 'garage-door');
    door.width.value = 9;
    garage.openings!.push({ ...structuredClone(door), id: 'x', edge: 7 });
    garage.openings!.push({ ...structuredClone(door), id: 'y', edge: 2, width: d(1) });
    garage.openEdges = [9, 2];
    const n = garage.openings!.length;
    expect(issuesOf(home).map((i) => i.path)).toEqual([
      `outbuildings[${at}].openEdges[0]`,
      `outbuildings[${at}].openings[${doorAt}].width`,
      `outbuildings[${at}].openings[${n - 2}].edge`,
      `outbuildings[${at}].openings[${n - 1}].edge`,
    ]);
  });

  it('rejects roof windows past the ridge and duplicate ids', () => {
    const home = realHome();
    const roof = home.building.roof as Extract<HomeModel['building']['roof'], { type: 'gable' }>;
    const [windowAt, window] = byId(roof.windows!, 'roof-window-south');
    const [passageAt, passage] = byId(home.outbuildings!, 'entrance-passage');
    window.fromEave.value = 6;
    passage.id = 'garage';
    expect(issuesOf(home).map((i) => i.path)).toEqual(
      expect.arrayContaining([
        `outbuildings[${passageAt}].id`,
        `building.roof.windows[${windowAt}].length`,
      ]),
    );
  });
});

describe('home model JSON Schema', () => {
  it('is committed and up to date (run `pnpm schema:generate`)', () => {
    expect(readJson('../schema/home-model.schema.json')).toEqual(homeModelJsonSchema());
  });
});

describe('formatPath', () => {
  it('uses dots for keys and brackets for indexes', () => {
    expect(formatPath(['walls', 3, 'start', 'x'])).toBe('walls[3].start.x');
    expect(formatPath([])).toBe('');
  });
});

describe('ListHomesQuery', () => {
  it('coerces and defaults the limit', () => {
    expect(ListHomesQuery.parse({})).toEqual({ limit: 50 });
    expect(ListHomesQuery.parse({ limit: '5' })).toEqual({ limit: 5 });
  });
});
