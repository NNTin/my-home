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

  it('carries a source on every number in the mock home', () => {
    const offenders: string[] = [];
    const walk = (value: unknown, path: (string | number)[]) => {
      if (Array.isArray(value)) return value.forEach((v, i) => walk(v, [...path, i]));
      if (typeof value === 'number' && formatPath(path) !== 'schemaVersion') {
        const parentIsDimension = path.at(-1) === 'value';
        if (!parentIsDimension) offenders.push(formatPath(path));
      }
      if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        if ('value' in obj && !('source' in obj)) offenders.push(formatPath(path));
        for (const [k, v] of Object.entries(obj)) walk(v, [...path, k]);
      }
    };
    walk(mockHome(), []);
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
