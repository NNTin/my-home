import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HomeModel, OutbuildingKind, OutdoorAreaKind } from '../model/home-model';
import {
  createFinishLibrary,
  deviceTextureFiles,
  finishes,
  textureFiles,
  type Finish,
  type FinishSource,
  type FinishSurface,
} from './index';
import {
  buildingFinishes,
  CUT_FINISH,
  DEFAULT_FINISHES,
  interiorLevelId,
  outbuildingFinishes,
  outdoorAreaFinish,
  resolveFinish,
  roomFinishes,
  SHELL_FINISHES,
  stairFinishes,
  TERRAIN_FINISH,
  withoutFinishes,
  type ResolvedFinish,
} from '../model/finish-defaults';
import { createFinishListing, finishListing, joinAbout } from './listing';

const readHome = (path: string) =>
  HomeModel.parse(JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')));
const realHome = () => readHome('../../../../data/homes/home.json');
const mockHome = () => readHome('../../test-fixtures/mock-home.json');

const plain: Finish = {
  id: 'paint.test',
  name: 'Test paint',
  surfaces: ['wall'],
  tint: '#ffffff',
  tintable: true,
  roughness: 1,
  metalness: 0,
};
const textured: Finish = {
  ...plain,
  id: 'wood.test',
  texture: { id: 'wood-test', maps: ['color', 'normal'] },
  tileSize: 1,
};

const source: FinishSource = {
  provider: 'Poly Haven',
  assetId: 'x',
  url: 'https://polyhaven.com/a/x',
  licence: 'CC0-1.0',
  fetched: '2026-11-23',
};

describe('the finish library', () => {
  it('has the finishes of the design and those added from photos, in library order', () => {
    expect(finishes.finishes.map((f) => f.id)).toEqual([
      'wood.oak-laminate',
      'tile.light-60',
      'concrete.screed',
      'floor.neutral',
      'plaster.fine',
      'paint.plain',
      'shell.neutral',
      'render.facade',
      'roof.clay-tile',
      'cut.dark',
      'grass.lawn',
      'paving.concrete-slab',
      'gravel.fine',
      'asphalt.plain',
      'soil.plain',
      'stone.rubble',
      'wood.veneer',
      'fabric.weave',
      'metal.brushed',
      'ceramic.white',
      'plastic.matt',
      'glass.clear',
    ]);
    expect(finishes.finishes.filter((f) => f.texture)).toHaveLength(14);
    expect(finishes.get('paint.plain')?.tintable).toBe(true);
    expect(finishes.get('nope.nope')).toBeUndefined();
  });

  it('takes every texture from a CC0 library, with a tile size', () => {
    expect(finishListing.map((f) => f.id)).toEqual(finishes.finishes.map((f) => f.id));
    for (const finish of finishListing) {
      expect(finish, finish.id).toMatchObject(finishes.get(finish.id)!);
      expect(finish.description.length, finish.id).toBeGreaterThan(20);
      expect(finish.source === undefined, finish.id).toBe(finish.texture === undefined);
    }
    for (const finish of finishListing.filter((f) => f.texture)) {
      expect(finish.source?.licence, finish.id).toBe('CC0-1.0');
      expect(['Poly Haven', 'ambientCG'], finish.id).toContain(finish.source?.provider);
      expect(finish.tileSize, finish.id).toBeGreaterThan(0);
    }
  });

  it('draws a tile of 60 cm: four tiles each way in one repeat of 2.4 m', () => {
    expect(finishes.get('tile.light-60')).toMatchObject({
      tileSize: 2.4,
      surfaces: ['floor', 'wall'],
    });
  });

  it('rejects a broken definition at import', () => {
    const broken =
      (finish: Partial<Finish>, base = plain) =>
      () =>
        createFinishLibrary([{ ...base, ...finish }]);
    expect(broken({ id: 'Paint' })).toThrow('must look like "material.name"');
    expect(() => createFinishLibrary([plain, plain])).toThrow('duplicate id');
    expect(broken({ tint: '#FFFFFF' })).toThrow('not a lower-case #rrggbb colour');
    expect(broken({ roughness: 2 })).toThrow('from 0 to 1');
    expect(broken({ surfaces: ['wall', 'wall'] })).toThrow('distinct kinds of surface');
    expect(broken({ surfaces: ['window' as FinishSurface] })).toThrow('distinct kinds');
    expect(broken({ tileSize: 1 })).toThrow('a plain finish has no tile size');
    expect(broken({ tileSize: undefined }, textured)).toThrow('needs a tile size');
    expect(broken({ texture: { id: 'wood-test', maps: ['color'] } }, textured)).toThrow(
      'has a normal map',
    );
    expect(() => createFinishLibrary([textured, { ...textured, id: 'wood.other' }])).toThrow(
      'belongs to another finish',
    );
    expect(createFinishLibrary([plain, textured]).finishes).toHaveLength(2);
  });

  it('rejects a finish that is not described, or a texture without a CC0 source', () => {
    const library = createFinishLibrary([plain, textured]);
    const said = {
      'paint.test': { description: 'A test finish.' },
      'wood.test': { description: 'A test wood.', source },
    };
    const listing = createFinishListing(library, said);
    expect(listing.map((f) => f.id)).toEqual(['paint.test', 'wood.test']);
    expect(listing[1]).toMatchObject({ name: 'Test paint', tileSize: 1, source });
    const broken = (about: Parameters<typeof createFinishListing>[1]) => () =>
      createFinishListing(library, { ...said, ...about });
    expect(() => createFinishListing(library, { 'wood.test': said['wood.test'] })).toThrow(
      'Invalid finish "paint.test": a finish needs a description',
    );
    expect(broken({ 'paint.test': { description: ' ' } })).toThrow('needs a description');
    expect(broken({ 'paint.test': { description: 'x', source } })).toThrow(
      'a plain finish has no source',
    );
    expect(broken({ 'wood.test': { description: 'x' } })).toThrow('needs a source');
    expect(
      broken({
        'wood.test': { description: 'x', source: { ...source, licence: 'CC-BY-4.0' as 'CC0-1.0' } },
      }),
    ).toThrow('the licence must be CC0-1.0');
    expect(
      broken({
        'wood.test': {
          description: 'x',
          source: { ...source, provider: 'A photo' as 'Poly Haven' },
        },
      }),
    ).toThrow('must be a CC0 library');
    expect(broken({ 'wood.test': { description: 'x', source: { ...source, crop: 2 } } })).toThrow(
      'the crop is a share',
    );
    expect(broken({ 'tile.gone': { description: 'x' } })).toThrow('described, but not defined');
    // Two groups' files that describe the same finish: neither entry is dropped in silence.
    expect(
      joinAbout([{ 'paint.test': said['paint.test'] }, { 'wood.test': said['wood.test'] }]),
    ).toEqual(said);
    expect(() =>
      joinAbout([
        { 'paint.test': said['paint.test'] },
        { 'paint.test': { description: 'Another.' } },
      ]),
    ).toThrow('Invalid finish "paint.test": described twice');
  });
});

describe('texture files per device', () => {
  const paths = (id: string, device: 'phone' | 'desktop') =>
    deviceTextureFiles(finishes.get(id)!, device).map((f) => f.path);

  it('gives a phone the 512 px colour and normal maps and nothing else', () => {
    expect(paths('wood.oak-laminate', 'phone')).toEqual([
      'wood-oak-laminate/color-512.webp',
      'wood-oak-laminate/normal-512.webp',
    ]);
  });

  it('gives a desktop the 1024 px maps with the roughness map', () => {
    expect(paths('wood.oak-laminate', 'desktop')).toEqual([
      'wood-oak-laminate/color-1024.webp',
      'wood-oak-laminate/normal-1024.webp',
      'wood-oak-laminate/roughness-1024.webp',
    ]);
  });

  it('has no colour map for a relief-only set and no file for a plain finish', () => {
    expect(paths('plaster.fine', 'phone')).toEqual(['plaster-fine/normal-512.webp']);
    expect(paths('render.facade', 'desktop')).toEqual(['render-facade/normal-1024.webp']);
    expect(textureFiles(finishes.get('paint.plain')!)).toEqual([]);
  });

  it('never gives a device two sizes of a set', () => {
    for (const finish of finishes.finishes) {
      for (const device of ['phone', 'desktop'] as const) {
        const sizes = new Set(deviceTextureFiles(finish, device).map((f) => f.size));
        expect(sizes.size, `${finish.id} on a ${device}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('default finishes', () => {
  /** A resolved finish names a finish of the library that may be used on that surface. */
  const expectFits = (resolved: ResolvedFinish, surface: FinishSurface, what: string) => {
    const finish = finishes.get(resolved.finish);
    expect(finish, what).toBeDefined();
    expect(finish!.surfaces, `${what}: ${resolved.finish}`).toContain(surface);
    expect(resolved.tint, what).toMatch(/^#[0-9a-f]{6}$/);
  };

  it('resolves for every surface of the real home when it names no finish', () => {
    const home = withoutFinishes(realHome());
    expect(JSON.stringify(home)).not.toContain('"finish');
    expect(interiorLevelId(home)).toBe('souterrain');
    for (const room of home.rooms) {
      const f = roomFinishes(home, room);
      if (room.levelId === 'souterrain') {
        expect(f.floor.finish, room.id).toBe('floor.neutral');
        expect(f.walls.finish, room.id).toBe('paint.plain');
        expect(f.ceiling.finish, room.id).toBe('paint.plain');
      } else {
        expect(f, room.id).toBe(SHELL_FINISHES);
      }
      expectFits(f.floor, 'floor', room.id);
      expectFits(f.walls, 'wall', room.id);
      expectFits(f.ceiling, 'ceiling', room.id);
    }
    const building = buildingFinishes(home.building);
    expect(building.facade.finish).toBe('render.facade');
    expect(building.roof.finish).toBe('roof.clay-tile');
    expectFits(building.facade, 'facade', 'facade');
    expectFits(building.roof, 'roof', 'roof');
    for (const area of home.outdoorAreas) expectFits(outdoorAreaFinish(area), 'ground', area.id);
    for (const b of home.outbuildings ?? []) {
      expectFits(outbuildingFinishes(b).walls, 'facade', b.id);
      expectFits(outbuildingFinishes(b).roof, 'facade', `${b.id} roof`);
    }
    for (const stair of home.stairs ?? []) {
      const { treads, risers, railing, balusters } = stairFinishes(stair);
      expectFits(treads, 'floor', stair.id);
      expectFits(risers, 'wall', `${stair.id} risers`);
      expectFits(railing, 'part', `${stair.id} railing`);
      expectFits(balusters, 'part', `${stair.id} balusters`);
    }
  });

  it('resolves the real home’s own finishes, each for its kind of surface', () => {
    const home = realHome();
    for (const room of home.rooms) {
      const f = roomFinishes(home, room);
      if (room.levelId !== 'souterrain') expect(f, room.id).toBe(SHELL_FINISHES);
      expectFits(f.floor, 'floor', room.id);
      expectFits(f.walls, 'wall', room.id);
      expectFits(f.ceiling, 'ceiling', room.id);
    }
    expect(
      roomFinishes(
        home,
        home.rooms.find((r) => r.id === 'souterrain-kitchen')!,
      ),
    ).toEqual({
      floor: { finish: 'wood.oak-laminate', tint: '#edd5b0', rotation: 0 },
      walls: { finish: 'paint.plain', tint: '#f2efe8', rotation: 0 },
      ceiling: { finish: 'paint.plain', tint: '#f2efe8', rotation: 0 },
    });
    const building = buildingFinishes(home.building);
    expectFits(building.facade, 'facade', 'facade');
    expectFits(building.roof, 'roof', 'roof');
    for (const area of home.outdoorAreas) expectFits(outdoorAreaFinish(area), 'ground', area.id);
    const rubble = home.outdoorAreas.filter((a) => outdoorAreaFinish(a).finish === 'stone.rubble');
    expect(rubble.map((a) => a.kind)).toEqual(Array(14).fill('embankment'));
  });

  it('has a default for every kind of outdoor area and outbuilding', () => {
    expect(
      Object.fromEntries(
        OutdoorAreaKind.options.map((kind) => [kind, outdoorAreaFinish({ kind }).finish]),
      ),
    ).toEqual({
      garden: 'grass.lawn',
      driveway: 'paving.concrete-slab',
      patio: 'paving.concrete-slab',
      path: 'paving.concrete-slab',
      road: 'asphalt.plain',
      gravel: 'gravel.fine',
      embankment: 'concrete.screed',
    });
    for (const kind of OutbuildingKind.options) {
      expectFits(outbuildingFinishes({ kind }).walls, 'facade', kind);
    }
    // As the outbuildings have always been coloured.
    expect(outbuildingFinishes({ kind: 'shed' }).walls).toEqual({
      finish: 'paint.plain',
      tint: '#9a7b56',
      rotation: 0,
    });
  });

  it('draws the ground with soil and cut faces dark', () => {
    expect(TERRAIN_FINISH.finish).toBe('soil.plain');
    expect(CUT_FINISH).toEqual({ finish: 'cut.dark', tint: '#35322f', rotation: 0 });
    expect(finishes.get(DEFAULT_FINISHES.cut)?.surfaces).toEqual([]);
  });

  it('takes the finish, tint and turn of a use, and the finish’s own colour without a tint', () => {
    expect(
      resolveFinish(
        { finish: 'wood.oak-laminate', tint: '#d9c2a0', rotation: 90, source: 'measured' },
        { finish: 'floor.neutral' },
      ),
    ).toEqual({ finish: 'wood.oak-laminate', tint: '#d9c2a0', rotation: 90 });
    expect(
      resolveFinish({ finish: 'tile.light-60', source: 'mock' }, { finish: 'floor.neutral' }),
    ).toEqual({ finish: 'tile.light-60', tint: '#ffffff', rotation: 0 });
  });

  it('falls back to the default for a finish the library does not have', () => {
    expect(
      resolveFinish({ finish: 'wood.gone', source: 'mock' }, { finish: 'floor.neutral' }).finish,
    ).toBe('floor.neutral');
  });

  it('uses a room’s finishes on the lowest level and the neutral shell above', () => {
    const home = mockHome();
    const room = home.rooms.find((r) => r.levelId === 'souterrain')!;
    const withFloor = {
      ...room,
      finishes: { floor: { finish: 'tile.light-60', source: 'mock' as const } },
    };
    expect(roomFinishes(home, withFloor).floor.finish).toBe('tile.light-60');
    expect(roomFinishes(home, withFloor).walls.finish).toBe('paint.plain');
    expect(roomFinishes(home, { ...withFloor, levelId: 'ground-floor' })).toBe(SHELL_FINISHES);
  });
});
