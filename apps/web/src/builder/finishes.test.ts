import { finishes, HomeModel, withoutFinishes } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import realHomeJson from '../../../../data/homes/home.json';
import mockHomeJson from '../../../../packages/shared/test-fixtures/mock-home.json';
import { pointInPolygon } from '../geom/geometry';
import { buildHome, type HomeScene, type WallFace } from './buildHome';
import { PLAN_COLORS, shellItems } from './drawList';
import { toOutline } from './plan';

// Finishes in the builder and the draw list (docs/design/realistic-render.md §5.4, §5.5): defaults
// by kind, wall faces by room, UV frames, and "Plan colours".

/** The real home as its defaults draw it: its own finishes are taken out. */
const realModel = () => withoutFinishes(HomeModel.parse(structuredClone(realHomeJson)));
const mockModel = () => HomeModel.parse(structuredClone(mockHomeJson));
const home = buildHome(realModel());
const mock = buildHome(mockModel());

const chosen = (finish: string, rest: Record<string, unknown> = {}) => ({
  finish,
  source: 'estimated-from-photo' as const,
  ...rest,
});

/** The two long faces of walls: what borders a room or is the building's outside. */
const longFaces = (scene: HomeScene) =>
  scene.wallFaces.filter((f) => f.part === 'front' || f.part === 'back');

/** The plan point just in front of a long face, where its room is. */
function inFront(face: WallFace): [number, number] {
  const [x, , z] = face.center;
  const along = face.outline.reduce((sum, p) => sum + p[0], 0) / face.outline.length;
  const across = face.outline[0]![2] + Math.sign(face.outline[0]![2]) * 0.05;
  const [c, sn] = [Math.cos(face.rotationY), Math.sin(face.rotationY)];
  // The wall's frame turned by `rotationY` about y.
  return [x + along * c + across * sn, z - along * sn + across * c];
}

describe('default finishes of a home that names none', () => {
  it.each([
    ['home', home],
    ['mock-home', mock],
  ])('every shell item of %s names a finish of the library', (_name, scene) => {
    for (const item of shellItems(scene)) {
      expect(finishes.get(item.finish), `${item.id}: ${item.finish}`).toBeDefined();
      expect(item.tint, item.id).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('draws the souterrain plain and the levels above as neutral shells', () => {
    const floors = Object.fromEntries(home.roomFloors.map((r) => [r.roomId, r.finish.finish]));
    expect(floors['souterrain-kitchen']).toBe('floor.neutral');
    expect(floors['ground-floor-interior']).toBe('shell.neutral');
    expect(floors['first-floor-interior']).toBe('shell.neutral');
    for (const c of home.roomCeilings) {
      expect(c.finish.finish).toBe(c.levelId === 'souterrain' ? 'paint.plain' : 'shell.neutral');
    }
    for (const c of home.ceilings) expect(c.finish.finish).toBe('paint.plain');
    for (const s of home.slabs) expect(s.finish.finish).toBe('shell.neutral');
  });

  it('draws the outside by kind: facade, roof, ground, outbuildings, stairs', () => {
    expect(new Set(home.roofPlanes.map((r) => r.finish.finish))).toEqual(
      new Set(['roof.clay-tile']),
    );
    const areas = Object.fromEntries(home.outdoorAreas.map((a) => [a.kind, a.finish.finish]));
    expect(areas).toEqual({
      driveway: 'paving.concrete-slab',
      garden: 'grass.lawn',
      patio: 'paving.concrete-slab',
      embankment: 'concrete.screed',
      path: 'paving.concrete-slab',
      gravel: 'gravel.fine',
      road: 'asphalt.plain',
    });
    const garage = home.outbuildings.find((b) => b.kind === 'garage')!;
    expect(garage.finishes.walls).toEqual({
      finish: 'render.facade',
      tint: '#e4e0d6',
      rotation: 0,
    });
    expect(home.stairs[0]!.finishes).toMatchObject({
      treads: { finish: 'wood.oak-laminate' },
      risers: { finish: 'paint.plain' },
      railing: { finish: 'wood.veneer' },
      balusters: { finish: 'metal.brushed' },
    });
    const terrain = shellItems(home).filter((i) => i.group.kind === 'terrain');
    expect(new Set(terrain.map((i) => i.finish))).toEqual(new Set(['soil.plain']));
  });
});

describe('wall faces', () => {
  it('every wall has faces on both sides', () => {
    for (const [scene, model] of [
      [home, realModel()],
      [mock, mockModel()],
    ] as const) {
      for (const wall of model.walls) {
        const faces = longFaces(scene).filter((f) => f.wallId === wall.id);
        expect(
          faces.some((f) => f.part === 'front'),
          wall.id,
        ).toBe(true);
        expect(
          faces.some((f) => f.part === 'back'),
          wall.id,
        ).toBe(true);
      }
    }
  });

  it('a face takes the wall finish of the room in front of it', () => {
    const model = realModel();
    const rooms = model.rooms.map((r) => ({ ...r, plan: toOutline(r.outline) }));
    let bordering = 0;
    for (const face of longFaces(home)) {
      const room = rooms.find(
        (r) => r.levelId === face.levelId && pointInPolygon(inFront(face), r.plan),
      );
      expect(face.roomId, face.id).toBe(room?.id);
      if (room) bordering += 1;
    }
    // One face per room a wall borders: no longer one per stretch between openings.
    expect(bordering).toBeGreaterThan(30);
  });

  it('a face that borders no room outside the footprint is an outer face: the facade', () => {
    const footprint = toOutline(realModel().building.footprint);
    const exterior = new Set(
      realModel()
        .walls.filter((w) => w.kind === 'exterior')
        .map((w) => w.id),
    );
    const outer = longFaces(home).filter(
      (f) => exterior.has(f.wallId) && !f.roomId && !pointInPolygon(inFront(f), footprint),
    );
    expect(outer.length).toBeGreaterThanOrEqual(exterior.size);
    for (const face of outer) expect(face.finish.finish).toBe('render.facade');
    // No room is ever drawn with the facade.
    for (const face of home.wallFaces.filter((f) => f.roomId)) {
      expect(face.finish.finish).not.toBe('render.facade');
    }
  });

  it('the two faces of a wall between two rooms take each room’s own finish', () => {
    const model = realModel();
    const room = (id: string) => model.rooms.find((r) => r.id === id)!;
    room('souterrain-kitchen').finishes = { walls: chosen('tile.light-60') };
    room('souterrain-bath-room').finishes = { walls: chosen('plaster.fine', { tint: '#dde6ee' }) };
    const scene = buildHome(model);
    const faces = scene.wallFaces;
    const of = (id: string) => faces.filter((f) => f.roomId === id);
    expect(of('souterrain-kitchen').length).toBeGreaterThan(3);
    for (const f of of('souterrain-kitchen')) expect(f.finish.finish).toBe('tile.light-60');
    for (const f of of('souterrain-bath-room')) {
      expect(f.finish).toEqual({ finish: 'plaster.fine', tint: '#dde6ee', rotation: 0 });
    }
    for (const f of of('souterrain-corridor')) expect(f.finish.finish).toBe('paint.plain');
    // Some wall has the kitchen on one side and another room on the other.
    expect(
      realModel().walls.some((w) => {
        const own = longFaces(scene).filter((f) => f.wallId === w.id);
        return (
          own.some((f) => f.roomId === 'souterrain-kitchen') &&
          own.some((f) => f.roomId !== undefined && f.roomId !== 'souterrain-kitchen')
        );
      }),
    ).toBe(true);
  });

  it('the reveal of a window is the room’s wall indoors and the facade outdoors', () => {
    const reveals = home.wallFaces.filter((f) => f.openingId === 'window-souterrain-kitchen-north');
    expect(reveals).toHaveLength(8);
    expect(new Set(reveals.filter((f) => f.roomId).map((f) => f.finish.finish))).toEqual(
      new Set(['paint.plain']),
    );
    expect(new Set(reveals.filter((f) => !f.roomId).map((f) => f.finish.finish))).toEqual(
      new Set(['render.facade']),
    );
  });

  it('textures run along the wall from its start and up from its floor', () => {
    const model = realModel();
    for (const wall of home.wallFaces) {
      const source = model.walls.find((w) => w.id === wall.wallId)!;
      const level = model.levels.find((l) => l.id === wall.levelId)!;
      expect(wall.uv.origin).toEqual([
        source.start.x.value,
        level.elevation.value,
        source.start.z.value,
      ]);
      expect(wall.uv.v).toEqual([0, 1, 0]);
      expect(Math.hypot(...wall.uv.u)).toBeCloseTo(1, 9);
      expect(wall.uv.u[1]).toBe(0);
    }
  });
});

describe('room ceilings', () => {
  it('lie just under the slab above, one per room, and none under the pitched roof', () => {
    const model = realModel();
    expect(home.roomCeilings.map((c) => c.roomId)).toEqual(
      model.rooms.filter((r) => r.levelId !== 'first-floor').map((r) => r.id),
    );
    for (const c of home.roomCeilings) {
      const level = model.levels.find((l) => l.id === c.levelId)!;
      expect(c.y).toBeCloseTo(level.elevation.value + level.height.value - 0.005, 9);
      expect(c.y).toBeLessThan(level.elevation.value + level.height.value);
    }
  });

  it('are open where a stair leaves the level', () => {
    const hall = home.roomCeilings.find((c) => c.roomId === 'souterrain-stair-hall')!;
    expect(hall.holes).toEqual([home.stairs[0]!.well]);
  });

  it('are shown and hidden like lowered ceilings: with the level above', () => {
    const items = shellItems(home).filter((i) => i.id.endsWith(':ceiling'));
    expect(items.length).toBe(home.roomCeilings.length);
    for (const item of items) expect(item.group.kind).toBe('ceiling');
  });
});

describe('finishes of the home model', () => {
  const finished = (): HomeScene => {
    const model = realModel();
    model.rooms.find((r) => r.id === 'souterrain-living-room')!.finishes = {
      floor: chosen('wood.oak-laminate', { tint: '#d9c2a0', rotation: 90 }),
      ceiling: chosen('plaster.fine'),
    };
    model.building.finishes = { facade: chosen('render.facade', { tint: '#e8e0d0' }) };
    model.outdoorAreas.find((a) => a.id === 'driveway')!.finish = chosen('gravel.fine');
    model.stairs![0]!.finish = chosen('tile.light-60');
    model.stairs![0]!.risers = chosen('plaster.fine', { tint: '#e2d5c2' });
    model.stairs![0]!.railing = chosen('plastic.matt', { tint: '#303030' });
    model.outbuildings!.find((b) => b.kind === 'shed')!.finish = chosen('paint.plain', {
      tint: '#ffffff',
    });
    return buildHome(HomeModel.parse(model));
  };

  it('reach the draw list with their tint', () => {
    const items = shellItems(finished());
    const item = (id: string) => items.find((i) => i.id === id)!;
    expect(item('souterrain-living-room:floor')).toMatchObject({
      finish: 'wood.oak-laminate',
      tint: '#d9c2a0',
    });
    expect(item('souterrain-living-room:ceiling').finish).toBe('plaster.fine');
    expect(item('souterrain-kitchen:floor').finish).toBe('floor.neutral');
    expect(item('driveway').finish).toBe('gravel.fine');
    const facade = items.filter((i) => i.finish === 'render.facade' && i.tint === '#e8e0d0');
    expect(facade.filter((i) => i.group.kind === 'level').length).toBe(
      shellItems(home).filter((i) => i.finish === 'render.facade' && i.group.kind === 'level')
        .length,
    );
    // A chimney that names no finish has the facade's.
    expect(facade.filter((i) => i.group.kind === 'roof').map((i) => i.id)).toEqual([
      'roof-chimney',
    ]);
    expect(
      items.filter((i) => i.id.includes(':tread') || i.id.includes(':landing'))[0]!.finish,
    ).toBe('tile.light-60');
    const stair = (part: string) => items.find((i) => i.id.includes(`:${part}:`))!;
    expect(stair('flight')).toMatchObject({ finish: 'plaster.fine', tint: '#e2d5c2' });
    expect(items.find((i) => i.id.endsWith(':slab'))!.finish).toBe('plaster.fine');
    for (const part of ['post', 'stringer', 'handrail']) {
      expect(stair(part)).toMatchObject({ finish: 'plastic.matt', tint: '#303030' });
    }
    expect(stair('baluster').finish).toBe('metal.brushed');
  });

  it('a floor turned by a quarter runs its texture along plan z', () => {
    const items = shellItems(finished());
    expect(items.find((i) => i.id === 'souterrain-living-room:floor')!.uv).toEqual({
      origin: [0, 0, 0],
      u: [0, 0, 1],
      v: [-1, 0, 0],
    });
    expect(items.find((i) => i.id === 'souterrain-kitchen:floor')!.uv).toBeUndefined();
  });
});

describe('the finishes of the real home (#113)', () => {
  const real = buildHome(HomeModel.parse(structuredClone(realHomeJson)));
  const items = shellItems(real);
  const item = (id: string) => items.find((i) => i.id === id)!;

  it('draws the oak floor in the rooms, tiles in the bath room and concrete in the boiler room', () => {
    for (const room of ['corridor', 'kitchen', 'living-room', 'bed-room', 'work-room']) {
      expect(item(`souterrain-${room}:floor`), room).toMatchObject({
        finish: 'wood.oak-laminate',
        tint: '#edd5b0',
      });
      // Planks run east-west, along the corridor: no quarter turn.
      expect(item(`souterrain-${room}:floor`).uv, room).toBeUndefined();
    }
    const faces = real.wallFaces;
    const walls = (room: string) =>
      new Set(faces.filter((f) => f.roomId === `souterrain-${room}`).map((f) => f.finish.finish));
    expect(walls('bath-room')).toEqual(new Set(['tile.light-60']));
    expect(walls('corridor')).toEqual(new Set(['plaster.fine']));
    expect(walls('kitchen')).toEqual(new Set(['paint.plain']));
    // The stair hall (#145): the corridor's floor carried on, and its plaster.
    expect(item('souterrain-stair-hall:floor')).toMatchObject({
      finish: 'wood.oak-laminate',
      tint: '#edd5b0',
    });
    expect(walls('stair-hall')).toEqual(new Set(['plaster.fine']));
    expect(item('souterrain-boiler-room:floor').finish).toBe('concrete.screed');
    expect(item('souterrain-boiler-room:ceiling')).toMatchObject({
      finish: 'paint.plain',
      tint: '#b8b7b3',
    });
  });

  it('tiles the bath room floor in its own tint, darker than its walls (#146)', () => {
    expect(item('souterrain-bath-room:floor')).toMatchObject({
      finish: 'tile.light-60',
      tint: '#c2b7a8',
    });
  });

  it('keeps the defaults where no photo shows the surface', () => {
    expect(new Set(real.roofPlanes.map((r) => r.finish.finish))).toEqual(
      new Set(['roof.clay-tile']),
    );
  });

  it('draws the facade in its own tint and the walls of the patio entrance as rubble', () => {
    const facade = items.filter((i) => i.finish === 'render.facade' && i.group.kind === 'level');
    expect(facade.length).toBeGreaterThan(10);
    expect(new Set(facade.map((i) => i.tint))).toEqual(new Set(['#e5e3de']));
    const rubble = real.outdoorAreas.filter((a) => a.finish.finish === 'stone.rubble');
    expect(rubble).toHaveLength(14);
    expect(new Set(rubble.map((a) => a.kind))).toEqual(new Set(['embankment']));
    expect(item('patio-souterrain').finish).toBe('paving.concrete-slab');
    expect(item('garden-souterrain').finish).toBe('grass.lawn');
  });

  it('leaves the levels above as neutral shells', () => {
    expect(item('ground-floor-interior:floor').finish).toBe('shell.neutral');
    expect(item('ground-floor-interior:ceiling').finish).toBe('shell.neutral');
    // The attic is under the roof: it has a floor and no ceiling surface.
    expect(item('first-floor-interior:floor').finish).toBe('shell.neutral');
  });
});

describe('"Plan colours"', () => {
  it('restores the room colours of the viewer before finishes, in the order of the rooms', () => {
    const floors = shellItems(home, { planColours: true }).filter(
      (i) => i.shape.kind === 'surface' && i.group.kind === 'level',
    );
    expect(floors).toHaveLength(home.roomFloors.length);
    expect(PLAN_COLORS).toEqual(['#e9d8b4', '#d7e3c8', '#cfdbe6', '#ead0cc', '#ddd3e8', '#e6e0c4']);
    floors.forEach((floor, i) => {
      expect(floor.tint).toBe(PLAN_COLORS[i % PLAN_COLORS.length]);
      expect(floor.finish).toBe('floor.neutral');
    });
  });

  it('is off by default, and changes nothing but the room floors', () => {
    const plain = shellItems(home);
    const coloured = shellItems(home, { planColours: true });
    expect(shellItems(home, {})).toEqual(plain);
    expect(coloured.map((i) => i.id)).toEqual(plain.map((i) => i.id));
    const changed = coloured.filter((item, i) => item.tint !== plain[i]!.tint);
    expect(changed.every((i) => i.id.endsWith(':floor') && i.group.kind === 'level')).toBe(true);
    expect(changed).toHaveLength(home.roomFloors.length);
  });

  it('overrides a room’s own floor finish too', () => {
    const model = realModel();
    model.rooms.find((r) => r.id === 'souterrain-kitchen')!.finishes = {
      floor: chosen('tile.light-60'),
    };
    const scene = buildHome(model);
    const kitchen = (options?: { planColours: boolean }) =>
      shellItems(scene, options).find((i) => i.id === 'souterrain-kitchen:floor')!;
    expect(kitchen().finish).toBe('tile.light-60');
    expect(kitchen({ planColours: true }).finish).toBe('floor.neutral');
  });
});
