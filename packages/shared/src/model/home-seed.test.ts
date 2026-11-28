import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HomeModel } from './home-model';
import {
  canonicalSeed,
  emptySeed,
  formatSeed,
  HomeSeed,
  isSeedChange,
  normalizeSeed,
  seedIssues,
  type SeedPlacement,
} from './home-seed';

const homesFolder = new URL('../../../../data/homes/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, homesFolder), 'utf8');
const seedFiles = readdirSync(homesFolder).filter((name) => name.endsWith('.seed.json'));
const realHome = () => HomeModel.parse(JSON.parse(read('home.json')));

const bed: SeedPlacement = {
  id: 'souterrain-bed-1',
  typeId: 'furniture.bed',
  name: 'Bedroom · Bed',
  levelId: 'souterrain',
  position: { x: 10.8, z: -3.5 },
  rotationY: 0,
  params: { width: 1.8 },
};

// CI: every seed in data/homes is valid, fits its home and the catalogue, and is canonical.
describe('the seeds in data/homes', () => {
  it('has the seed of home.json', () => {
    expect(seedFiles).toContain('home.seed.json');
  });

  for (const file of seedFiles) {
    describe(file, () => {
      const text = read(file);
      const seed = HomeSeed.parse(JSON.parse(text));
      const model = HomeModel.parse(JSON.parse(read(file.replace(/\.seed\.json$/, '.json'))));

      it('fits its home and the catalogue: types, params, levels, opening ids, notes', () => {
        expect(seedIssues(seed, model)).toEqual([]);
      });

      it('is canonical and normalised (what the export writes)', () => {
        expect(text).toBe(formatSeed(normalizeSeed(seed)));
      });
    });
  }
});

describe('seedIssues', () => {
  const home = realHome();
  const seed = (s: Partial<HomeSeed>): HomeSeed => ({ ...emptySeed(home.id), ...s });
  const paths = (s: Partial<HomeSeed>) => seedIssues(seed(s), home).map((i) => i.path);

  it('accepts an empty seed and a valid placement', () => {
    expect(seedIssues(seed({ placements: [bed] }), home)).toEqual([]);
  });

  it('checks placements: type, kind, params, level, ids', () => {
    expect(paths({ placements: [{ ...bed, typeId: 'furniture.nope' }] })).toEqual([
      'placements[0].typeId',
    ]);
    expect(paths({ placements: [{ ...bed, typeId: 'window.casement' }] })).toEqual([
      'placements[0].typeId',
    ]);
    expect(paths({ placements: [{ ...bed, params: { width: 99 } }] })).toEqual([
      'placements[0].params.width',
    ]);
    expect(paths({ placements: [{ ...bed, levelId: 'cellar' }] })).toEqual([
      'placements[0].levelId',
    ]);
    expect(paths({ placements: [bed, bed] })).toEqual(['placements[1].id']);
    expect(paths({ placements: [{ ...bed, id: home.rooms[0]!.id }] })).toEqual([
      'placements[0].id',
    ]);
    // An outdoor piece stands outside the rooms: on the patio, not in the bed room.
    const pergola = { ...bed, id: 'souterrain-pergola-1', typeId: 'garden.pergola', params: {} };
    expect(paths({ placements: [{ ...pergola, position: { x: 16, z: -4 } }] })).toEqual([]);
    expect(seedIssues(seed({ placements: [pergola] }), home)).toEqual([
      {
        path: 'placements[0].position',
        message:
          'The lean-to pergola is an outdoor piece: it stands outside the rooms, not in Bed room',
      },
    ]);
  });

  it('checks overrides: the use is in the model, of that type, with valid params', () => {
    const use = home.openings.find((o) => o.typeId === 'window.tilt-turn')!;
    const ok = { useId: use.id, typeId: use.typeId, params: { handleSide: 'left' } };
    expect(paths({ openingOverrides: [ok] })).toEqual([]);
    expect(paths({ openingOverrides: [{ ...ok, useId: 'nope' }] })).toEqual([
      'openingOverrides[0].useId',
    ]);
    expect(paths({ openingOverrides: [{ ...ok, typeId: 'window.casement' }] })).toEqual([
      'openingOverrides[0].typeId',
    ]);
    expect(paths({ openingOverrides: [{ ...ok, params: { handleSide: 'up' } }] })).toEqual([
      'openingOverrides[0].params.handleSide',
    ]);
  });

  it('checks notes: type in the catalogue, use in the model or placed', () => {
    const note = {
      id: '00000000-0000-4000-8000-000000000001',
      subject: { kind: 'use' as const, id: bed.id },
      body: 'Guest bed',
      createdBy: 'owner' as const,
      updatedBy: 'owner' as const,
      createdAt: '2026-11-19T10:00:00.000Z',
      updatedAt: '2026-11-19T10:00:00.000Z',
    };
    expect(paths({ placements: [bed], notes: [note] })).toEqual([]);
    expect(paths({ notes: [note] })).toEqual(['notes[0].subject.id']);
    expect(paths({ notes: [{ ...note, subject: { kind: 'type', id: 'window.nope' } }] })).toEqual([
      'notes[0].subject.id',
    ]);
  });

  it('checks the home id', () => {
    expect(seedIssues({ ...emptySeed('other') }, home).map((i) => i.path)).toEqual(['homeId']);
  });
});

describe('canonicalSeed', () => {
  it('sorts by stable id and orders keys, so a diff shows only what changed', () => {
    const b = { ...bed, id: 'a-bed-1', params: { width: 1.8, color: '#112233' } };
    const shuffled = JSON.parse(
      JSON.stringify({
        notes: [],
        openingOverrides: [],
        placements: [bed, b],
        homeId: 'home',
        schemaVersion: 1,
      }),
    ) as HomeSeed;
    const canonical = canonicalSeed(shuffled);
    expect(Object.keys(canonical)).toEqual([
      'schemaVersion',
      'homeId',
      'placements',
      'openingOverrides',
      'notes',
    ]);
    expect(canonical.placements.map((p) => p.id)).toEqual(['a-bed-1', 'souterrain-bed-1']);
    expect(Object.keys(canonical.placements[0]!.params)).toEqual(['color', 'width']);
    expect(formatSeed(canonical)).toBe(formatSeed(canonicalSeed(canonical)));
  });

  it('normalises params like the api (colours lower-cased)', () => {
    const s = normalizeSeed({
      ...emptySeed('home'),
      placements: [{ ...bed, params: { color: '#AABBCC' } }],
    });
    expect(s.placements[0]!.params).toEqual({ color: '#aabbcc' });
  });
});

describe('isSeedChange', () => {
  it('is a system change named seed (a deploy) or seed import by … (an import)', () => {
    expect(isSeedChange({ actor: 'system', actorName: 'seed' })).toBe(true);
    expect(isSeedChange({ actor: 'system', actorName: 'seed import by nntin-bot' })).toBe(true);
    expect(isSeedChange({ actor: 'system', actorName: null })).toBe(false);
    expect(isSeedChange({ actor: 'agent', actorName: 'seed' })).toBe(false);
  });
});

describe('mounting and elevation in the seed (#63)', () => {
  const home = realHome();
  const cabinet: SeedPlacement = {
    id: 'souterrain-wall-cabinet-1',
    typeId: 'kitchen.wall-cabinet',
    name: 'Stair hall · Wall cabinet',
    levelId: 'souterrain',
    position: { x: 10.76, z: -10.3 },
    rotationY: 0,
    mounting: 'wall',
    elevation: 1.33,
    params: {},
  };

  it('omits them on the floor at 0, so seeds from before them read and write the same', () => {
    const floor = { ...bed, mounting: 'floor' as const, elevation: 0 };
    expect(canonicalSeed({ ...emptySeed(home.id), placements: [floor] }).placements).toEqual([bed]);
    expect(
      Object.keys(canonicalSeed({ ...emptySeed(home.id), placements: [cabinet] }).placements[0]!),
    ).toEqual([
      'id',
      'typeId',
      'name',
      'levelId',
      'position',
      'rotationY',
      'mounting',
      'elevation',
      'params',
    ]);
  });

  it('accepts the type’s mountings and rejects others and an elevation under the ceiling', () => {
    const issues = (p: SeedPlacement) =>
      seedIssues({ ...emptySeed(home.id), placements: [p] }, home).map((i) => i.message);
    expect(issues(cabinet)).toEqual([]);
    expect(issues({ ...cabinet, mounting: 'ceiling' })).toEqual([
      'A wall cabinet cannot be mounted under the ceiling',
    ]);
    const light: SeedPlacement = {
      ...cabinet,
      id: 'souterrain-downlight-1',
      typeId: 'fixture.downlight',
      mounting: 'ceiling',
      elevation: 0.5,
    };
    expect(issues(light)).toEqual([
      'A piece under the ceiling has no elevation: it hangs at the ceiling',
    ]);
    // A downlight without a mounting stands on the floor: not one of its mountings.
    expect(
      issues({ ...light, mounting: undefined, elevation: undefined } as SeedPlacement),
    ).toEqual(['A downlight cannot be mounted on the floor']);
    expect(
      HomeSeed.safeParse({ ...emptySeed(home.id), placements: [{ ...cabinet, elevation: -1 }] })
        .success,
    ).toBe(false);
  });
});
