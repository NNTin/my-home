import { catalog, defaultParams, furnitureSize, LEGACY_FURNITURE_TYPE_IDS } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import { buildFence, FENCE_BAY } from '../builder/buildHome';
import { furniture } from './furniture';
import { createPieces, pieces } from './registry';
import { definePiece, type PieceModule } from './types';

const piece = (overrides: Partial<PieceModule> = {}) => ({
  default: definePiece({
    id: 'window.casement',
    parts: () => [],
    dimensions: () => [],
    ...overrides,
  }),
});

const casement = catalog.get('window.casement')!;

describe('piece registry', () => {
  it('has exactly one piece module per catalogue type, in catalogue order', () => {
    expect(pieces.all.map((p) => p.id)).toEqual(catalog.types.map((t) => t.id));
    expect(pieces.get('furniture.bed')?.id).toBe('furniture.bed');
    expect(pieces.get('bed')).toBeUndefined();
  });

  it('registers a module from its folder', () => {
    const r = createPieces({ './window/casement/index.ts': piece() }, [casement]);
    expect(r.all.map((p) => p.id)).toEqual(['window.casement']);
  });

  it('rejects invalid modules with the file path', () => {
    expect(() => createPieces({ './window/casement/index.ts': {} }, [casement])).toThrow(
      /window\/casement\/index.ts: expected `export default/,
    );
    expect(() => createPieces({ './window/sash/index.ts': piece() }, [casement])).toThrow(
      /"window.casement" must match its folder \("window.sash"\)/,
    );
    expect(() =>
      createPieces({ './window/casement/index.ts': piece({ id: 'Casement' }) }, [casement]),
    ).toThrow(/`id` must be a type id/);
    expect(() =>
      createPieces({ './window/casement/index.ts': piece({ parts: undefined as never }) }, [
        casement,
      ]),
    ).toThrow(/`parts` must be a function/);
  });

  it('rejects duplicates, modules without a type and types without a module', () => {
    expect(() =>
      createPieces(
        { './window/casement/index.ts': piece(), 'other/window/casement/index.ts': piece() },
        [casement],
      ),
    ).toThrow(/Duplicate piece module "window.casement"/);
    expect(() => createPieces({ './window/casement/index.ts': piece() }, [])).toThrow(
      /without a catalogue type: window.casement/,
    );
    expect(() => createPieces({}, [casement])).toThrow(/without a piece module: window.casement/);
  });

  it('gives every type parts and dimensions for its preview or default size', () => {
    for (const type of catalog.types) {
      const values = defaultParams(type);
      const size = furnitureSize(values);
      const ctx = type.preview ?? { width: size.width, height: size.height, wallDepth: size.depth };
      const module = pieces.get(type.id)!;
      expect(module.parts(values, ctx).length, type.id).toBeGreaterThan(0);
      expect(module.dimensions(values, ctx).length, type.id).toBeGreaterThan(0);
    }
  });
});

describe('gate piece', () => {
  it('builds a straight preview gate like a gate fence of that width', () => {
    const type = catalog.get('gate.swing')!;
    const parts = pieces.get('gate.swing')!.parts(defaultParams(type), {
      width: 1,
      height: 1.2,
      wallDepth: 0.1,
    });
    expect(parts.map((p) => p.role)).toEqual(['post', 'post', 'panel']);
    expect(parts[0]!.size).toEqual([0.1, 1.3, 0.1]);
    expect(parts[2]!.size).toEqual([1, 1.2, 0.04]);
    expect(parts.map((p) => p.color)).toEqual(['#3d4043', '#3d4043', '#6c7176']);
  });

  it('builds a gate fence from its effective values', () => {
    const dim = (value: number) => ({ value, source: 'mock' as const });
    const gate = {
      id: 'gate',
      name: 'Gate',
      kind: 'gate' as const,
      typeId: 'gate.swing',
      path: [
        { x: dim(0), z: dim(0) },
        { x: dim(3), z: dim(0) },
      ],
      height: dim(1.2),
      elevation: dim(0),
    };
    const built = buildFence(gate);
    expect(built.typeId).toBe('gate.swing');
    expect(built.values).toEqual(defaultParams(catalog.get('gate.swing')!));
    // 3 m in bays of at most 2.5 m: 2 panels, 3 posts.
    expect(built.panels).toHaveLength(Math.ceil(3 / FENCE_BAY));
    expect(built.parts?.map((p) => p.role)).toEqual(['post', 'post', 'post', 'panel', 'panel']);
    expect(built.parts?.[3]?.center).toEqual(built.panels[0]!.center);
  });
});

describe('furniture types', () => {
  it('lists every furniture type by category then name; legacy ids resolve too', () => {
    expect(furniture.categories.map((c) => c.name)).toEqual([
      'Bed room',
      'Corridor',
      'Dining',
      'Heating',
      'Kitchen',
      'Lighting',
      'Living room',
      'Work room',
    ]);
    const types = furniture.categories.flatMap((c) => c.types);
    expect(types.map((t) => t.legacyId ?? t.id)).toEqual([
      'bed',
      'wardrobe',
      'furniture.shoe-cabinet',
      'chair',
      'table',
      'fixture.radiator',
      'kitchen.base-cabinet',
      'appliance.fridge-freezer',
      'appliance.microwave',
      'furniture.storage-shelf',
      'kitchen.tall-cabinet',
      'kitchen.wall-cabinet',
      'kitchen.wall-shelf',
      'fixture.downlight',
      'sofa',
      'desk',
    ]);
    for (const t of types) {
      if (t.legacyId) expect(LEGACY_FURNITURE_TYPE_IDS[t.legacyId]).toBe(t.id);
    }
    expect(furniture.get('furniture.bed')?.snapping).toBe('back');
    expect(furniture.get('bed')).toBe(furniture.get('furniture.bed'));
  });

  it('offers and resolves wall, ceiling and worktop pieces too (#63)', () => {
    const offered = new Set(furniture.categories.flatMap((c) => c.types.map((t) => t.id)));
    for (const id of [
      'kitchen.wall-cabinet',
      'kitchen.wall-shelf',
      'appliance.microwave',
      'fixture.downlight',
      'fixture.radiator',
    ]) {
      expect(offered.has(id), id).toBe(true);
      expect(furniture.resolve(id)?.parts.length, id).toBeGreaterThan(0);
    }
    expect(furniture.resolve('fixture.downlight')!.size).toEqual({
      width: 0.085,
      depth: 0.085,
      height: 0.07,
    });
  });

  it('sizes an item from its props and derives the footprint from that size', () => {
    const bed = furniture.resolve('bed')!;
    expect(bed.size).toEqual({ width: 1.6, depth: 2, height: 0.5 });
    expect(bed.footprint).toEqual([
      [-0.8, -1],
      [0.8, -1],
      [0.8, 1],
      [-0.8, 1],
    ]);
    const wide = furniture.resolve('bed', { width: 1.8, color: '#112233' })!;
    expect(wide.size.width).toBe(1.8);
    expect(Math.max(...wide.footprint.map(([x]) => x))).toBeCloseTo(0.9);
    expect(wide.parts[0]!.color).toBe('#112233');
    // Invalid or design-only props are ignored, never thrown.
    expect(furniture.resolve('bed', { width: 9, height: 2, legs: [1] })!.size).toEqual(bed.size);
    const table = furniture.resolve('table', { diameter: 1.4 })!;
    expect(table.footprint).toHaveLength(16);
    expect(Math.max(...table.footprint.map(([x]) => x))).toBeCloseTo(0.7);
    expect(furniture.resolve('lamp')).toBeUndefined();
  });

  it('caches resolve() per type and props', () => {
    const a = furniture.resolve('furniture.bed', { width: 1.8 });
    expect(furniture.resolve('furniture.bed', { width: 1.8 })).toBe(a);
    expect(furniture.resolve('furniture.bed', { width: 1.7 })).not.toBe(a);
    expect(furniture.resolve('furniture.bed')).not.toBe(a);
  });
});
