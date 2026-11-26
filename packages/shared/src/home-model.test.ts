import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ceilingHeightAt,
  describeIssues,
  formatIssues,
  formatPath,
  HomeModel,
  homeModelJsonSchema,
  northBearingOf,
  roofOf,
  type ValidationIssue,
  wallLength,
} from './home-model';
import { catalog, modelUses } from './catalog';
import { ListHomesQuery } from './homes';

const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

const mockHome = () => structuredClone(readJson('../test-fixtures/mock-home.json')) as HomeModel;
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
      name: 'Too wide',
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

  it("rejects an id equal to the home's own id (it names the home's settings history)", () => {
    const home = mockHome();
    home.openings[0]!.id = home.id;
    expect(issuesOf(home)).toContainEqual({
      path: 'openings[0].id',
      message: `Duplicate id "${home.id}" (already used by the home)`,
    });
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
    for (const room of ['kitchen', 'bath-room', 'work-room']) {
      const { sill } = opening(`window-souterrain-${room}-north`);
      expect(sill).toBeGreaterThan(lawn);
      expect(sill - lawn).toBeLessThan(0.3);
    }
    for (const id of [
      'window-souterrain-living-room-south',
      'window-souterrain-living-room-south-east',
    ]) {
      const south = opening(id);
      expect(south.head).toBeLessThan(patch('terrain-south').elevation.value);
      expect(south.sill).toBeGreaterThan(patch('terrain-light-well').elevation.value);
    }
  });

  it('has a garage, a divider wall down to the patio and two gardens on their own levels', () => {
    const model = home();
    expect(model.outbuildings?.map((b) => b.kind)).toEqual(['garage', 'porch', 'shed', 'compost']);
    const slope = patch('terrain-garden-divider');
    expect(slope.elevation.value).toBe(patch('terrain-south').elevation.value);
    expect(slope.slope?.lowElevation.value).toBe(patch('terrain-lower').elevation.value);
    const gardens = model.outdoorAreas.filter((a) => a.kind === 'garden');
    expect(gardens.map((g) => [g.ownerApartmentId, g.elevation.value])).toEqual([
      ['apt-ground-floor', patch('terrain-south').elevation.value],
      ['apt-souterrain', patch('terrain-lower').elevation.value],
    ]);
  });
});

describe('the souterrain apartment of the real home', () => {
  const model = HomeModel.parse(realHome());
  const rooms = model.rooms.filter((r) => r.apartmentId === 'apt-souterrain');
  const box = (points: { x: { value: number }; z: { value: number } }[]) => {
    const xs = points.map((p) => p.x.value);
    const zs = points.map((p) => p.z.value);
    return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  };
  const room = (id: string) => box(rooms.find((r) => r.id === id)!.outline);
  const wall = (id: string) => model.walls.find((w) => w.id === id)!;
  /** Plan span of an opening along its (axis-aligned) wall. */
  const span = (id: string) => {
    const o = model.openings.find((x) => x.id === id)!;
    const w = wall(o.wallId);
    const length = wallLength(w);
    const at = (t: number) => ({
      x: { value: w.start.x.value + ((w.end.x.value - w.start.x.value) * t) / length },
      z: { value: w.start.z.value + ((w.end.z.value - w.start.z.value) * t) / length },
    });
    return box([at(o.offset.value), at(o.offset.value + o.width.value)]);
  };

  it('has the eight rooms with permanent ids and exact display names', () => {
    expect(rooms.map((r) => [r.id, r.name])).toEqual([
      ['souterrain-stair-hall', 'Stair hall'],
      ['souterrain-work-room', 'Work room'],
      ['souterrain-bath-room', 'Bath room'],
      ['souterrain-kitchen', 'Kitchen'],
      ['souterrain-corridor', 'Corridor'],
      ['souterrain-living-room', 'Living room'],
      ['souterrain-boiler-room', 'Boiler room'],
      ['souterrain-bed-room', 'Bed room'],
    ]);
  });

  it('lays the rooms out as a north row, a corridor and a south row without overlaps', () => {
    const boxes = rooms.map((r) => box(r.outline));
    boxes.forEach((a, i) =>
      boxes.slice(i + 1).forEach((b) => {
        const overlaps =
          a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.z0 < b.z1 - 1e-6 && b.z0 < a.z1 - 1e-6;
        expect(overlaps).toBe(false);
      }),
    );
    const corridor = room('souterrain-corridor');
    // North row, west to east, all north of the corridor.
    const north = ['stair-hall', 'work-room', 'bath-room', 'kitchen'].map((n) =>
      room(`souterrain-${n}`),
    );
    north.forEach((r, i) => {
      if (i > 0) expect(r.x0).toBeCloseTo(north[i - 1]!.x1);
      expect(r.z0).toBe(north[0]!.z0);
    });
    for (const r of north.slice(1)) expect(r.z1).toBeCloseTo(corridor.z0);
    // The corridor runs from the stair hall to the east wall.
    expect(corridor.x0).toBeCloseTo(room('souterrain-stair-hall').x1);
    expect(corridor.x1).toBe(room('souterrain-kitchen').x1);
    // South row: the living room reaches the south wall, the other two stop at the recess.
    const [living, boiler, bed] = ['living-room', 'boiler-room', 'bed-room'].map((n) =>
      room(`souterrain-${n}`),
    );
    for (const r of [living!, boiler!, bed!]) expect(r.z0).toBeCloseTo(corridor.z1);
    expect(living!.z1).toBeGreaterThan(boiler!.z1 + 1);
    expect(boiler!.z1).toBe(bed!.z1);
    expect(bed!.x1).toBe(corridor.x1);
  });

  it('has a door for every connection in the issue, on a wall between the two rooms', () => {
    const doors = model.openings.filter((o) => o.id.startsWith('door-souterrain-'));
    expect(doors.map((o) => o.id).sort()).toEqual([
      'door-souterrain-corridor-bath-room',
      'door-souterrain-corridor-bed-room',
      'door-souterrain-corridor-boiler-room',
      'door-souterrain-corridor-living-room',
      'door-souterrain-corridor-patio',
      'door-souterrain-corridor-stair-hall',
      'door-souterrain-work-room-corridor',
    ]);
    const corridor = room('souterrain-corridor');
    // The patio door sits on the east wall's centre line, half its thickness outside the corridor.
    const east = corridor.x1 + wall('souterrain-wall-east').thickness.value / 2;
    for (const door of doors) {
      expect(door.type).toBe('door');
      const s = span(door.id);
      // Every door lies on the corridor's edge, within the corridor's extent along that edge.
      const onEdge =
        [corridor.z0, corridor.z1].some(
          (z) => Math.abs(s.z0 - z) < 1e-6 && s.x0 >= corridor.x0 && s.x1 <= corridor.x1,
        ) ||
        [corridor.x0, east].some(
          (x) => Math.abs(s.x0 - x) < 1e-6 && s.z0 >= corridor.z0 && s.z1 <= corridor.z1,
        );
      if (door.id === 'door-souterrain-corridor-patio') {
        // The patio door is where the corridor's east end is open to the kitchen: it starts on the
        // corridor's edge and runs north into the kitchen's.
        const kitchen = room('souterrain-kitchen');
        expect(Math.abs(s.x0 - east)).toBeLessThan(1e-6);
        expect(s.z1).toBeGreaterThan(corridor.z0 + 0.25);
        expect(s.z1).toBeLessThanOrEqual(corridor.z1);
        expect(s.z0).toBeGreaterThanOrEqual(kitchen.z0);
        continue;
      }
      expect([door.id, onEdge]).toEqual([door.id, true]);
      // ... and within the other room's extent along it.
      const other = room(
        `souterrain-${door.id.replace('door-souterrain-', '').replace(/-?corridor-?/, '')}`,
      );
      const within =
        s.x0 === s.x1 ? s.z0 >= other.z0 && s.z1 <= other.z1 : s.x0 >= other.x0 && s.x1 <= other.x1;
      expect([door.id, within]).toEqual([door.id, true]);
    }
  });

  it('leaves the boundary between the kitchen and the corridor open: no wall on it', () => {
    const kitchen = room('souterrain-kitchen');
    const corridor = room('souterrain-corridor');
    expect(kitchen.z1).toBe(corridor.z0);
    const onBoundary = model.walls.filter((w) => {
      const b = box([w.start, w.end]);
      return (
        w.levelId === 'souterrain' &&
        b.z0 === b.z1 &&
        Math.abs(b.z0 - kitchen.z1) < 0.2 &&
        // The bath room's corridor wall reaches half its thickness past the corner, no further.
        b.x1 > kitchen.x0 + w.thickness.value / 2 + 1e-6
      );
    });
    expect(onBoundary).toEqual([]);
    // The bath room next to it does have its corridor wall.
    expect(box([wall('souterrain-wall-bath-room-corridor').start]).z0).toBe(kitchen.z1);
  });

  it('opens the entrance onto the corridor, with its sunken steps, and the east window into the bed room', () => {
    const corridor = room('souterrain-corridor');
    const door = span('door-souterrain-corridor-patio');
    // Its south part opens into the corridor, the rest into the kitchen beside it.
    expect(door.z1).toBeGreaterThan(corridor.z0);
    expect(door.z1).toBeLessThan(corridor.z1);
    expect(
      modelUses(model)
        .find((u) => u.id === 'door-souterrain-corridor-patio')!
        .roomIds.sort(),
    ).toEqual(['souterrain-corridor', 'souterrain-kitchen']);
    const entry = box(model.terrain.patches.find((p) => p.id === 'terrain-entry')!.outline);
    expect(entry.z0).toBeLessThanOrEqual(door.z0);
    expect(entry.z1).toBeGreaterThanOrEqual(door.z1);
    const bed = room('souterrain-bed-room');
    const window = span('window-souterrain-bed-room-east');
    expect(window.z0).toBeGreaterThan(bed.z0);
    expect(window.z1).toBeLessThan(bed.z1);
    // The window stays clear of the sunken entry.
    expect(window.z0).toBeGreaterThan(entry.z1);
  });

  it('gives every room of the north row its window', () => {
    for (const name of ['kitchen', 'bath-room', 'work-room']) {
      const r = room(`souterrain-${name}`);
      const window = span(`window-souterrain-${name}-north`);
      expect(window.x0).toBeGreaterThan(r.x0);
      expect(window.x1).toBeLessThan(r.x1);
    }
  });

  it('has exactly two entrances: through the stair hall and from the patio', () => {
    const apartment = model.apartments.find((a) => a.id === 'apt-souterrain')!;
    expect(apartment.entrances!.map((e) => [e.id, e.name, e.roomId, e.viaId])).toEqual([
      [
        'entrance-souterrain-stair-hall',
        'Stair hall entrance',
        'souterrain-stair-hall',
        'stair-souterrain-stair-hall-ground-floor',
      ],
      [
        'entrance-souterrain-patio',
        'Patio entrance',
        'souterrain-corridor',
        'door-souterrain-corridor-patio',
      ],
    ]);
    // The patio door is the apartment's only exterior door, and it opens onto the patio.
    const exterior = model.openings.filter(
      (o) =>
        o.type !== 'window' &&
        wall(o.wallId).levelId === 'souterrain' &&
        wall(o.wallId).kind === 'exterior',
    );
    expect(exterior.map((o) => o.id)).toEqual(['door-souterrain-corridor-patio']);
    const door = span('door-souterrain-corridor-patio');
    const patio = box(model.outdoorAreas.find((a) => a.id === 'patio-souterrain')!.outline);
    // It opens onto the sunken entry, whose steps lead east up to the patio's north end.
    const entry = box(model.terrain.patches.find((p) => p.id === 'terrain-entry')!.outline);
    expect(entry.z0).toBeLessThan(patio.z0);
    expect(entry.z1).toBeGreaterThan(patio.z0);
    // The patio itself is entered from the lane through the gate at its north end, the only gate.
    expect(model.fences!.filter((f) => f.kind === 'gate').map((f) => f.id)).toEqual([
      'gate-souterrain-patio-lane',
    ]);
    const gate = box(model.fences!.find((f) => f.id === 'gate-souterrain-patio-lane')!.path);
    expect(gate.x0).toBe(patio.x1);
    expect(gate.z0).toBe(patio.z0);
    // It is in line with the top of the steps: from the gate straight down to the door.
    expect(gate.z0).toBeLessThan(entry.z1);
    expect(gate.z1).toBeGreaterThan(entry.z0);
    expect(gate.z0).toBeLessThan(door.z1);
  });

  it('lowers the ceiling of the corridor and the kitchen to 2.15, and to 2.00 under the box (#61)', () => {
    const at = (x: number, z: number) => ceilingHeightAt(model, 'souterrain', x, z);
    expect(at(5, -6.6)).toBe(2.15);
    expect(at(11, -8.5)).toBe(2.15);
    expect(at(8.9, -6.6)).toBe(2.0);
    // The other rooms keep the level's clear height; an unknown level has none.
    expect(at(8, -8.5)).toBe(2.35);
    expect(at(11, -4)).toBe(2.35);
    expect(ceilingHeightAt(model, 'nowhere', 5, -6.6)).toBeUndefined();
    // The box spans the corridor from the Bath room door's east casing to the kitchen opening.
    const box = model.ceilings!.find((c) => c.id === 'souterrain-ceiling-corridor-box')!;
    expect(box.outline.map((p) => p.x.value)).toEqual([8.2, 9.56, 9.56, 8.2]);
    expect(span('door-souterrain-corridor-bath-room').x1).toBeLessThan(8.2);
    expect(span('door-souterrain-corridor-boiler-room').x1).toBeLessThan(8.2);
  });

  it('has a stair in the stair hall up to the ground floor', () => {
    const [stair] = model.stairs!;
    expect(stair).toMatchObject({ levelId: 'souterrain', toLevelId: 'ground-floor' });
    const hall = room('souterrain-stair-hall');
    const half = stair!.width.value / 2;
    const path = box(stair!.path);
    expect(path.x0 - half).toBeGreaterThanOrEqual(hall.x0);
    expect(path.x1 + half).toBeLessThanOrEqual(hall.x1);
    expect(path.z0 - half).toBeGreaterThanOrEqual(hall.z0);
    expect(path.z1).toBeLessThanOrEqual(hall.z1);
  });
});

describe('the outside of the real home', () => {
  const model = HomeModel.parse(realHome());
  const patch = (id: string) => model.terrain.patches.find((p) => p.id === id)!;

  it('divides the two gardens with a short, steep wall-like embankment, not an entrance', () => {
    const slope = patch('terrain-garden-divider');
    const zs = slope.outline.map((p) => p.z.value);
    const run = Math.max(...zs) - Math.min(...zs);
    const fall = slope.elevation.value - slope.slope!.lowElevation.value;
    expect(run).toBeLessThanOrEqual(1);
    expect(fall / run).toBeGreaterThan(1.5);
    const area = model.outdoorAreas.find((a) => a.id === 'garden-divider')!;
    expect(area.outline).toEqual(slope.outline);
    expect(area.slope).toEqual(slope.slope);
    expect(area).toMatchObject({ kind: 'embankment', name: 'Garden divider wall' });
    expect(area.ownerApartmentId).toBeUndefined();
    // South of it lies the ground-floor garden, north of it the souterrain patio.
    const edge = (id: string) =>
      model.outdoorAreas.find((a) => a.id === id)!.outline.map((p) => p.z.value);
    expect(Math.min(...edge('garden-ground-floor').filter((z) => z > 0.4))).toBe(Math.max(...zs));
    expect(Math.max(...edge('patio-souterrain'))).toBe(Math.min(...zs));
  });

  it('has gravel drainage strips along the facades, at the level of the ground next to them', () => {
    const strips = model.outdoorAreas.filter(
      (a) => a.kind === 'gravel' && a.id.startsWith('drainage-'),
    );
    expect(strips.map((a) => [a.id, a.elevation.value])).toEqual([
      ['drainage-north-east', patch('terrain-lower').elevation.value],
      ['drainage-west', patch('terrain-west').elevation.value],
      ['drainage-south', patch('terrain-south').elevation.value],
    ]);
  });

  it('draws the sunken entry on its terrain: paved landing, gravel treads, rubble side walls', () => {
    const box = (points: { x: { value: number }; z: { value: number } }[]) => ({
      x0: Math.min(...points.map((p) => p.x.value)),
      x1: Math.max(...points.map((p) => p.x.value)),
      z0: Math.min(...points.map((p) => p.z.value)),
      z1: Math.max(...points.map((p) => p.z.value)),
    });
    const entry = model.outdoorAreas.filter((a) => a.id.includes('-souterrain-entry'));
    expect(entry.map((a) => a.kind).sort()).toEqual([
      ...Array<string>(14).fill('embankment'),
      ...Array<string>(7).fill('gravel'),
      'path',
    ]);
    for (const area of entry) {
      // Each surface lies on a terrain patch of the same height and slope.
      const under = model.terrain.patches.find(
        (p) =>
          p.elevation.value === area.elevation.value &&
          p.slope?.lowElevation.value === area.slope?.lowElevation.value &&
          [box(area.outline)].every(
            (b) =>
              b.x0 >= box(p.outline).x0 &&
              b.x1 <= box(p.outline).x1 &&
              b.z0 >= box(p.outline).z0 &&
              b.z1 <= box(p.outline).z1,
          ),
      );
      expect([area.id, under?.id.startsWith('terrain-entry')]).toEqual([area.id, true]);
    }
  });

  it('is fenced on the east, north and along the driveway, with a gate to the patio', () => {
    expect(model.fences!.map((f) => [f.id, f.kind])).toEqual([
      ['fence-east-garden', 'chain-link'],
      ['fence-east-garden-divider', 'privacy'],
      ['fence-east-patio', 'privacy'],
      ['gate-souterrain-patio-lane', 'gate'],
      ['fence-east-souterrain-garden', 'privacy'],
      ['fence-north', 'chain-link'],
      ['fence-west-driveway', 'trellis'],
    ]);
    // The east line is continuous: each piece starts where the previous one ends, at its height.
    const east = model.fences!.filter((f) => f.path.every((p) => p.x.value === 19.3));
    expect(east).toHaveLength(5);
    expect(east.at(-1)!.elevation.value).toBe(patch('terrain-lower').elevation.value);
    east.slice(1).forEach((f, i) => {
      const before = east[i]!;
      expect(f.path[0]).toMatchObject({
        x: { value: before.path.at(-1)!.x.value },
        z: { value: before.path.at(-1)!.z.value },
      });
      // Along the lane the pieces also meet in height; the last one stands on the garden level.
      if (f.id !== 'fence-east-souterrain-garden') {
        expect(f.elevation.value).toBe((before.endElevation ?? before.elevation).value);
      }
    });
  });
});

describe('the ground-floor garden of the real home', () => {
  const model = HomeModel.parse(realHome());
  const zs = (id: string) =>
    model.outdoorAreas.find((a) => a.id === id)!.outline.map((p) => p.z.value);
  const garden = model.outdoorAreas.find((a) => a.id === 'garden-ground-floor')!;

  it('ends at the street on the same line as the driveway', () => {
    expect(Math.max(...zs('garden-ground-floor'))).toBe(Math.max(...zs('driveway')));
    expect(Math.min(...zs('street'))).toBeLessThan(Math.max(...zs('driveway')));
  });

  it('loses its south-east corner to the road junction, where the lane fence ends', () => {
    const corner = garden.outline.map((p) => [p.x.value, p.z.value]);
    expect(corner).toContainEqual([15.5, 8]);
    expect(corner).not.toContainEqual([19.3, 10.3]);
    const street = model.outdoorAreas.find((a) => a.id === 'street')!;
    expect(street.outline.map((p) => [p.x.value, p.z.value])).toContainEqual([15.5, 8]);
    const fence = model.fences!.find((f) => f.id === 'fence-east-garden')!;
    expect(fence.kind).toBe('chain-link');
    expect(Math.max(...fence.path.map((p) => p.z.value))).toBe(8);
  });

  it('has a garden shed and a compost standing on the lawn', () => {
    for (const [id, kind] of [
      ['shed-ground-floor-garden', 'shed'],
      ['compost-ground-floor-garden', 'compost'],
    ] as const) {
      const b = model.outbuildings!.find((o) => o.id === id)!;
      expect(b.kind).toBe(kind);
      expect(b.floorElevation.value).toBe(garden.elevation.value);
      for (const p of b.footprint) {
        // Inside the garden's main rectangle, clear of the terrace and the cut corner.
        expect(p.x.value).toBeGreaterThan(1.9);
        expect(p.x.value).toBeLessThan(15.5);
        expect(p.z.value).toBeGreaterThan(1.5);
        expect(p.z.value).toBeLessThan(10.3);
      }
    }
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
    const [slopeAt, slope] = byId(home.terrain.patches, 'terrain-garden-divider');
    const [laneAt, lane] = byId(home.terrain.patches, 'terrain-lane');
    const [pathAt, path] = byId(home.outdoorAreas, 'garden-divider');
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
    garage.openings!.push({ ...structuredClone(door), id: 'x', name: 'X', edge: 7 });
    garage.openings!.push({ ...structuredClone(door), id: 'y', name: 'Y', edge: 2, width: d(1) });
    garage.openEdges = [9, 2];
    const n = garage.openings!.length;
    expect(issuesOf(home).map((i) => i.path)).toEqual([
      `outbuildings[${at}].openEdges[0]`,
      `outbuildings[${at}].openings[${doorAt}].width`,
      `outbuildings[${at}].openings[${n - 2}].edge`,
      `outbuildings[${at}].openings[${n - 1}].edge`,
    ]);
  });

  it('rejects stairs that lead nowhere, go down, turn askew or have no room for a landing', () => {
    const home = realHome();
    const stair = home.stairs![0]!;
    const down = {
      ...structuredClone(stair),
      id: 'down',
      levelId: 'ground-floor',
      toLevelId: 'souterrain',
    };
    const lost = {
      ...structuredClone(stair),
      id: 'lost',
      toLevelId: 'nowhere',
      apartmentId: 'nobody',
    };
    const askew = structuredClone(stair);
    askew.id = 'askew';
    askew.path[2]!.z.value += 1;
    const cramped = structuredClone(stair);
    cramped.id = 'cramped';
    cramped.path[2]!.x.value = cramped.path[1]!.x.value - cramped.width.value;
    cramped.path[3]!.x.value = cramped.path[2]!.x.value;
    home.stairs!.push(down, lost, askew, cramped);
    expect(issuesOf(home).map((i) => i.path)).toEqual([
      'stairs[1].toLevelId',
      'stairs[2].toLevelId',
      'stairs[2].apartmentId',
      'stairs[3].path[1]',
      'stairs[3].path[2]',
      'stairs[4].path[2]',
    ]);
  });

  it('rejects ceilings on unknown levels or apartments, not below the level, or with a taken id', () => {
    const home = realHome();
    const ceiling = home.ceilings![0]!;
    const high = { ...structuredClone(ceiling), id: 'high', height: d(2.35) };
    const lost = { ...structuredClone(ceiling), id: 'lost', levelId: 'nowhere' };
    const stray = { ...structuredClone(ceiling), id: 'stray', apartmentId: 'nobody' };
    const twin = { ...structuredClone(ceiling), id: 'souterrain-corridor' };
    home.ceilings!.push(high, lost, stray, twin);
    expect(issuesOf(home).map((i) => i.path)).toEqual([
      'ceilings[5].id',
      'ceilings[2].height',
      'ceilings[3].levelId',
      'ceilings[4].apartmentId',
    ]);
  });

  it('accepts a home without ceilings', () => {
    const home = realHome();
    delete home.ceilings;
    expect(HomeModel.safeParse(home).success).toBe(true);
  });

  it('rejects entrances into a room of another apartment or through nothing', () => {
    const home = realHome();
    const [at, apartment] = byId(home.apartments, 'apt-souterrain');
    apartment.entrances![0]!.roomId = 'ground-floor-interior';
    apartment.entrances![1]!.viaId = 'souterrain-corridor';
    apartment.entrances!.push({
      id: 'souterrain',
      name: 'x',
      roomId: 'nowhere',
      viaId: 'garage-door',
    });
    expect(issuesOf(home).map((i) => i.path)).toEqual([
      `apartments[${at}].entrances[2].id`,
      `apartments[${at}].entrances[0].roomId`,
      `apartments[${at}].entrances[1].viaId`,
      `apartments[${at}].entrances[2].roomId`,
      `apartments[${at}].entrances[2].viaId`,
    ]);
  });

  it('rejects entrances through a window, a door of another room or a stair elsewhere', () => {
    const home = realHome();
    const [at, apartment] = byId(home.apartments, 'apt-souterrain');
    const entrance = (id: string, roomId: string, viaId: string) => ({
      id,
      name: id,
      roomId,
      viaId,
    });
    apartment.entrances!.push(
      entrance('e-window', 'souterrain-bed-room', 'window-souterrain-bed-room-east'),
      entrance('e-other-room', 'souterrain-stair-hall', 'door-souterrain-corridor-bed-room'),
      entrance('e-far-wall', 'souterrain-kitchen', 'door-souterrain-corridor-living-room'),
      entrance('e-stair', 'souterrain-corridor', 'stair-souterrain-stair-hall-ground-floor'),
      // Fine: a door leads into the rooms on both sides of its wall, a stair into both its ends.
      entrance('e-ok-door', 'souterrain-bed-room', 'door-souterrain-corridor-bed-room'),
      entrance('e-ok-door-2', 'souterrain-corridor', 'door-souterrain-corridor-bed-room'),
      // ... and a door where two rooms meet without a wall into both of them.
      entrance('e-ok-open-end', 'souterrain-kitchen', 'door-souterrain-corridor-patio'),
    );
    expect(issuesOf(home)).toEqual([
      {
        path: `apartments[${at}].entrances[2].viaId`,
        message: 'Entrance "e-window" leads through "window-souterrain-bed-room-east", a window',
      },
      {
        path: `apartments[${at}].entrances[3].viaId`,
        message:
          'Door "door-souterrain-corridor-bed-room" is not on a wall of room "souterrain-stair-hall"',
      },
      {
        path: `apartments[${at}].entrances[4].viaId`,
        message:
          'Door "door-souterrain-corridor-living-room" is not on a wall of room "souterrain-kitchen"',
      },
      {
        path: `apartments[${at}].entrances[5].viaId`,
        message:
          'Stair "stair-souterrain-stair-hall-ground-floor" does not start or end in room "souterrain-corridor"',
      },
    ]);
  });

  it('rejects fences that repeat a point or reuse an id', () => {
    const home = realHome();
    const [at, fence] = byId(home.fences!, 'fence-north');
    fence.path.push(structuredClone(fence.path.at(-1)!));
    fence.id = 'garage';
    expect(issuesOf(home).map((i) => i.path)).toEqual([
      `fences[${at}].id`,
      `fences[${at}].path[2]`,
    ]);
  });

  it('keeps documents without stairs, fences and entrances valid', () => {
    const home = realHome();
    delete home.stairs;
    delete home.fences;
    for (const apartment of home.apartments) delete apartment.entrances;
    expect(HomeModel.safeParse(home).success).toBe(true);
    const mock = mockHome();
    expect(mock.stairs ?? mock.fences).toBeUndefined();
    expect(HomeModel.safeParse(mock).success).toBe(true);
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

describe('piece types and names', () => {
  const at = <T extends { id: string }>(list: T[], id: string) => {
    const i = list.findIndex((x) => x.id === id);
    return [i, list[i]!] as const;
  };
  const gableOf = (home: HomeModel) =>
    home.building.roof as Extract<HomeModel['building']['roof'], { type: 'gable' }>;

  it('rejects unknown and malformed type ids', () => {
    const home = mockHome();
    home.openings[0]!.typeId = 'door.revolving';
    expect(issuesOf(home)).toEqual([
      { path: 'openings[0].typeId', message: 'Unknown piece type "door.revolving"' },
    ]);
    home.openings[0]!.typeId = 'Door';
    const issues = issuesOf(home);
    expect(issues.map((i) => i.path)).toEqual(['openings[0].typeId', 'openings[0].typeId']);
    expect(issues.map((i) => i.message)).toEqual([
      expect.stringMatching(/family\.name/),
      'Unknown piece type "Door"',
    ]);
  });

  it('rejects a type that sits somewhere else', () => {
    const home = realHome();
    const [i] = at(home.openings, 'ground-floor-window-south');
    home.openings[i]!.typeId = 'window.roof';
    const roof = gableOf(home);
    roof.windows![0]!.typeId = 'window.casement';
    const [g, gate] = at(home.fences!, 'gate-souterrain-patio-lane');
    gate.typeId = 'door.exterior';
    const [b, garage] = at(home.outbuildings!, 'garage');
    garage.openings![0]!.typeId = 'gate.swing';
    expect(issuesOf(home)).toEqual(
      expect.arrayContaining([
        {
          path: `openings[${i}].typeId`,
          message: 'Type "window.roof" goes in a roof, not in a wall',
        },
        {
          path: 'building.roof.windows[0].typeId',
          message: 'Type "window.casement" goes in a wall, not in a roof',
        },
        {
          path: `fences[${g}].typeId`,
          message: 'Type "door.exterior" goes in a wall, not in a fence line',
        },
        {
          path: `outbuildings[${b}].openings[0].typeId`,
          message: 'Type "gate.swing" goes in a fence line, not in a wall',
        },
      ]),
    );
  });

  it("rejects a type that does not carry the opening's kind", () => {
    const home = mockHome();
    const [i] = at(home.openings, 'souterrain-bedroom-window');
    home.openings[i]!.typeId = 'door.interior';
    const [j] = at(home.openings, 'souterrain-bedroom-door');
    home.openings[j]!.typeId = 'door.french';
    expect(issuesOf(home)).toEqual([
      {
        path: `openings[${i}].typeId`,
        message:
          'Opening "souterrain-bedroom-window" is a window but type "door.interior" is for doors',
      },
      {
        path: `openings[${j}].typeId`,
        message:
          'Opening "souterrain-bedroom-door" is a door but type "door.french" is for French doors',
      },
    ]);
  });

  it('needs a type on a gate and none on other fences', () => {
    const home = realHome();
    const [g, gate] = at(home.fences!, 'gate-souterrain-patio-lane');
    delete gate.typeId;
    const [f, fence] = at(home.fences!, 'fence-north');
    fence.typeId = 'gate.swing';
    const issues = issuesOf(home);
    expect(issues).toHaveLength(2);
    expect(issues).toEqual(
      expect.arrayContaining([
        {
          path: `fences[${f}].typeId`,
          message: 'Fence "fence-north" is a chain-link fence and takes no typeId',
        },
        {
          path: `fences[${g}].typeId`,
          message: 'Gate "gate-souterrain-patio-lane" needs a typeId',
        },
      ]),
    );
  });

  it('needs a name on every opening and unique names across all uses, ignoring case', () => {
    const home = realHome();
    home.openings[1]!.name = home.openings[0]!.name.toUpperCase();
    const roof = gableOf(home);
    roof.windows![0]!.name = 'Garage · Garage door';
    const [g, gate] = at(home.fences!, 'gate-souterrain-patio-lane');
    gate.name = home.openings[2]!.name;
    const [b] = at(home.outbuildings!, 'garage');
    expect(issuesOf(home)).toEqual([
      {
        path: 'openings[1].name',
        message: `Duplicate name "${home.openings[1]!.name}" (already used by openings[0])`,
      },
      {
        path: 'building.roof.windows[0].name',
        message: `Duplicate name "Garage · Garage door" (already used by outbuildings[${b}].openings[0])`,
      },
      {
        path: `fences[${g}].name`,
        message: `Duplicate name "${gate.name}" (already used by openings[2])`,
      },
    ]);

    const unnamed = mockHome() as { openings: Record<string, unknown>[] };
    delete unnamed.openings[0]!.name;
    expect(issuesOf(unnamed).map((i) => i.path)).toEqual(['openings[0].name']);
  });

  it('lists every use of the mock home, with the rooms an opening touches', () => {
    const uses = modelUses(HomeModel.parse(mockHome()));
    expect(uses).toHaveLength(22);
    expect(uses.every((u) => u.placement === 'wall' && u.kind === 'openings')).toBe(true);
    expect(uses.find((u) => u.id === 'souterrain-bedroom-door')).toEqual({
      id: 'souterrain-bedroom-door',
      typeId: 'door.interior',
      name: 'Bedroom door',
      kind: 'openings',
      placement: 'wall',
      levelId: 'souterrain',
      roomIds: ['souterrain-hallway', 'souterrain-bedroom'],
      hole: { width: 0.9, height: 2.05 },
    });
    expect(uses.find((u) => u.id === 'souterrain-bedroom-window')?.roomIds).toEqual([
      'souterrain-bedroom',
    ]);
  });

  it('lists the roof window, outbuilding openings and gate of the real home', () => {
    const uses = modelUses(HomeModel.parse(realHome()));
    expect(uses).toHaveLength(32);
    expect(uses.slice(-5).map((u) => [u.id, u.placement, u.typeId, u.levelId])).toEqual([
      ['garage-door', 'outbuilding', 'door.garage', null],
      ['passage-arch', 'outbuilding', 'door.exterior', null],
      ['shed-ground-floor-garden-door', 'outbuilding', 'door.exterior', null],
      ['roof-window-south', 'roof', 'window.roof', 'first-floor'],
      ['gate-souterrain-patio-lane', 'fence', 'gate.swing', null],
    ]);
  });

  it('gives every use of both homes a name and a known type', () => {
    for (const home of [mockHome(), realHome()]) {
      for (const use of modelUses(HomeModel.parse(home))) {
        expect(use.name.trim(), use.id).not.toBe('');
        expect(catalog.get(use.typeId), use.id).toBeDefined();
      }
    }
  });
});

describe('finishes', () => {
  const use = (finish: string, rest: Record<string, unknown> = {}) => ({
    finish,
    source: 'estimated-from-photo' as const,
    ...rest,
  });
  /** The first room of the lowest level: the only level whose rooms take finishes. */
  const souterrainRoom = (home: HomeModel) => home.rooms.find((r) => r.levelId === 'souterrain')!;

  it('accepts the mock home, which names no finish', () => {
    expect(HomeModel.safeParse(mockHome()).success).toBe(true);
    expect(JSON.stringify(mockHome())).not.toContain('"finish');
  });

  it('accepts the real home: every finish cites photos, or is a default that names its photo request', () => {
    const home = HomeModel.parse(realHome());
    const uses = [
      ...home.rooms.flatMap((r) => Object.values(r.finishes ?? {})),
      ...Object.values(home.building.finishes ?? {}),
      ...home.outdoorAreas.flatMap((a) => (a.finish ? [a.finish] : [])),
    ];
    expect(uses.length).toBeGreaterThan(40);
    for (const use of uses) {
      if (use.source === 'mock') {
        expect(use.photos, use.note).toBeUndefined();
        expect(use.tint, use.note).toBeUndefined();
        expect(use.note).toMatch(/^Default: .* \(photo request [0-9a-f]{8}\)$/);
      } else {
        expect(use.source).toBe('estimated-from-photo');
        expect(use.photos?.length, use.note).toBeGreaterThan(0);
        expect(use.note?.length, use.finish).toBeGreaterThan(0);
        // A tint is taken from two photos, or carried over from the room it was measured in.
        if (use.tint && !use.note?.includes('measured there')) {
          expect(use.photos!.length, use.note).toBeGreaterThanOrEqual(2);
        }
      }
    }
    // Every room of the souterrain is decided, surface by surface.
    for (const room of home.rooms.filter((r) => r.levelId === 'souterrain')) {
      expect(Object.keys(room.finishes ?? {}).sort(), room.id).toEqual([
        'ceiling',
        'floor',
        'walls',
      ]);
    }
  });

  it('accepts finishes on a room, the building, an outdoor area, an outbuilding and a stair', () => {
    const home = realHome();
    souterrainRoom(home).finishes = {
      floor: use('wood.oak-laminate', {
        tint: '#d9c2a0',
        rotation: 90,
        photos: ['0b0f6f0e-7f0a-4a52-9f43-6f1c2f0f7a11'],
        note: 'Planks run along the long side of the room',
      }),
      walls: use('tile.light-60'),
      ceiling: use('plaster.fine', { tint: '#ffffff' }),
    };
    home.building.finishes = {
      facade: use('render.facade', { tint: '#e8e0d0' }),
      roof: use('roof.clay-tile'),
    };
    home.outdoorAreas[0]!.finish = use('gravel.fine', { source: 'measured' });
    home.outbuildings![0]!.finish = use('paint.plain', { tint: '#ffffff' });
    home.stairs![0]!.finish = use('wood.oak-laminate');
    home.stairs![0]!.risers = use('plaster.fine', { tint: '#e2d5c2' });
    home.stairs![0]!.railing = use('metal.brushed');
    const result = HomeModel.safeParse(home);
    expect(result.error && describeIssues(formatIssues(result.error))).toBeUndefined();
  });

  it('rejects an unknown or malformed finish id', () => {
    const home = realHome();
    souterrainRoom(home).finishes = { floor: use('wood.mahogany') };
    home.building.finishes = { roof: use('Clay Tiles') };
    const index = home.rooms.indexOf(souterrainRoom(home));
    expect(issuesOf(home)).toContainEqual({
      path: 'building.finishes.roof.finish',
      message: 'Finish ids look like "material.name" (a-z, 0-9, "-")',
    });
    delete home.building.finishes;
    expect(issuesOf(home)).toEqual([
      { path: `rooms[${index}].finishes.floor.finish`, message: 'Unknown finish "wood.mahogany"' },
    ]);
  });

  it('rejects a finish on the wrong kind of surface', () => {
    const home = realHome();
    const index = home.rooms.indexOf(souterrainRoom(home));
    souterrainRoom(home).finishes = { floor: use('grass.lawn'), ceiling: use('wood.oak-laminate') };
    home.building.finishes = { facade: use('roof.clay-tile'), roof: use('cut.dark') };
    home.outdoorAreas[0]!.finish = use('paint.plain');
    home.stairs![0]!.finish = use('wood.veneer');
    home.stairs![0]!.risers = use('wood.veneer');
    home.stairs![0]!.railing = use('paint.plain');
    expect(issuesOf(home)).toEqual([
      {
        path: `rooms[${index}].finishes.floor.finish`,
        message: 'Finish "grass.lawn" is not for a floor (it is for the ground)',
      },
      {
        path: `rooms[${index}].finishes.ceiling.finish`,
        message: 'Finish "wood.oak-laminate" is not for a ceiling (it is for a floor)',
      },
      {
        path: 'building.finishes.facade.finish',
        message: 'Finish "roof.clay-tile" is not for a facade (it is for a roof)',
      },
      {
        path: 'building.finishes.roof.finish',
        message: 'Finish "cut.dark" is not for a roof (only the viewer draws it)',
      },
      {
        path: 'outdoorAreas[0].finish.finish',
        message:
          'Finish "paint.plain" is not for the ground (it is for a wall, a ceiling, a facade)',
      },
      {
        path: 'stairs[0].finish.finish',
        message: 'Finish "wood.veneer" is not for a floor (it is for a catalogue part)',
      },
      {
        path: 'stairs[0].risers.finish',
        message: 'Finish "wood.veneer" is not for a wall (it is for a catalogue part)',
      },
      {
        path: 'stairs[0].railing.finish',
        message:
          'Finish "paint.plain" is not for a catalogue part (it is for a wall, a ceiling, a facade)',
      },
    ]);
  });

  it('rejects a tint on a finish that cannot be tinted, and a malformed tint', () => {
    const home = realHome();
    home.building.finishes = { roof: use('roof.clay-tile', { tint: '#aa3322' }) };
    expect(issuesOf(home)).toEqual([
      { path: 'building.finishes.roof.tint', message: 'Finish "roof.clay-tile" cannot be tinted' },
    ]);
    home.building.finishes = { facade: use('render.facade', { tint: '#FFF' }) };
    expect(issuesOf(home)).toEqual([
      {
        path: 'building.finishes.facade.tint',
        message: 'Colours are written as #rrggbb, lower case',
      },
    ]);
  });

  it('turns only the finish of a room floor, by a quarter turn', () => {
    const home = realHome();
    const index = home.rooms.indexOf(souterrainRoom(home));
    souterrainRoom(home).finishes = { walls: use('tile.light-60', { rotation: 90 }) };
    home.outdoorAreas[0]!.finish = use('paving.concrete-slab', { rotation: 90 });
    expect(issuesOf(home)).toEqual([
      {
        path: `rooms[${index}].finishes.walls.rotation`,
        message: 'Only the finish of a room floor can be turned',
      },
      {
        path: 'outdoorAreas[0].finish.rotation',
        message: 'Only the finish of a room floor can be turned',
      },
    ]);
    souterrainRoom(home).finishes = { floor: use('wood.oak-laminate', { rotation: 45 }) };
    delete home.outdoorAreas[0]!.finish;
    expect(issuesOf(home).map((i) => i.path)).toEqual([`rooms[${index}].finishes.floor.rotation`]);
  });

  it('rejects finishes on rooms of the ground floor and the attic', () => {
    const home = realHome();
    for (const id of ['ground-floor-interior', 'first-floor-interior']) {
      home.rooms.find((r) => r.id === id)!.finishes = { floor: use('wood.oak-laminate') };
    }
    expect(issuesOf(home)).toEqual(
      ['ground-floor', 'first-floor'].map((level) => ({
        path: `rooms[${home.rooms.findIndex((r) => r.id === `${level}-interior`)}].finishes`,
        message:
          `Room "${level}-interior" is on level "${level}", which is not modelled inside: ` +
          'only rooms of the lowest level ("souterrain") take finishes',
      })),
    );
    // Even an empty object: the field itself is not allowed there.
    home.rooms.find((r) => r.id === 'first-floor-interior')!.finishes = {};
    delete home.rooms.find((r) => r.id === 'ground-floor-interior')!.finishes;
    expect(issuesOf(home)).toHaveLength(1);
  });

  it('needs a provenance and takes no unknown field or photo that is not an id', () => {
    const home = realHome();
    const index = home.rooms.indexOf(souterrainRoom(home));
    souterrainRoom(home).finishes = {
      floor: { finish: 'wood.oak-laminate' } as never,
      walls: use('paint.plain', { photos: ['IMG 1234.jpg'] }),
      ceiling: use('paint.plain', { gloss: 1 }),
    };
    expect(issuesOf(home).map((i) => i.path)).toEqual([
      `rooms[${index}].finishes.floor.source`,
      `rooms[${index}].finishes.walls.photos[0]`,
      `rooms[${index}].finishes.ceiling`,
    ]);
  });

  it('describes finish uses in the JSON Schema', () => {
    const schema = JSON.stringify(homeModelJsonSchema());
    expect(schema).toContain('"FinishUse"');
    expect(schema).toContain('"FinishId"');
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
