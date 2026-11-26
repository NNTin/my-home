import { catalog, defaultParams, furnitureSize } from '@my-home/shared';
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
    // Each post under its cap, the panel between its two rails, and the latch.
    expect(parts.map((p) => p.role)).toEqual([
      'post',
      'post',
      'post',
      'post',
      'panel',
      'panel',
      'panel',
      'handle',
    ]);
    expect(parts[0]!.size).toEqual([0.1, 1.3, 0.1]);
    expect(parts[1]!.center[1] - parts[1]!.size[1] / 2).toBeCloseTo(1.3);
    expect(parts[4]!.size).toEqual([1, 1.2, 0.04]);
    expect([parts[0]!.color, parts[2]!.color, parts[4]!.color]).toEqual([
      '#3d4043',
      '#3d4043',
      '#6c7176',
    ]);
    // The rails lie at the panel's top and bottom, inside its height, and stand proud of it.
    const [top, bottom] = [parts[6]!, parts[5]!];
    expect(top.center[1] + top.size[1] / 2).toBeCloseTo(1.2);
    expect(bottom.center[1] - bottom.size[1] / 2).toBeCloseTo(0);
    expect(top.size[2]).toBeCloseTo(0.06);
    expect(parts.every((p) => p.material?.finish === 'plastic.matt')).toBe(true);
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
    expect(built.parts?.filter((p) => p.role === 'post')).toHaveLength(6);
    expect(built.parts?.filter((p) => p.role === 'panel')).toHaveLength(6);
    expect(built.parts?.filter((p) => p.role === 'handle')).toHaveLength(1);
    expect(built.parts?.[6]?.center).toEqual(built.panels[0]!.center);
  });
});

describe('furniture types', () => {
  it('lists every furniture type by category then name', () => {
    expect(furniture.categories.map((c) => c.name)).toEqual([
      'Bath room',
      'Bed room',
      'Corridor',
      'Dining',
      'Facade',
      'Heating',
      'Kitchen',
      'Lighting',
      'Living room',
      'Work room',
    ]);
    const types = furniture.categories.flatMap((c) => c.types);
    expect(types.map((t) => t.id)).toEqual([
      'bath.corner-tub',
      'bath.ledge',
      'bath.shower',
      'bath.toilet',
      'bath.vanity',
      'appliance.washing-machine',
      'furniture.bed',
      'furniture.wardrobe',
      'furniture.shoe-cabinet',
      'furniture.chair',
      'furniture.table',
      'appliance.satellite-dish',
      'fixture.radiator',
      'kitchen.base-cabinet',
      'appliance.fridge-freezer',
      'appliance.microwave',
      'furniture.storage-shelf',
      'kitchen.tall-cabinet',
      'kitchen.wall-cabinet',
      'kitchen.wall-shelf',
      'fixture.downlight',
      'furniture.sofa',
      'furniture.desk',
    ]);
    expect(furniture.get('furniture.bed')?.snapping).toBe('back');
    expect(furniture.get('bed')).toBeUndefined();
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
    const bed = furniture.resolve('furniture.bed')!;
    expect(bed.size).toEqual({ width: 1.6, depth: 2, height: 0.5 });
    expect(bed.footprint).toEqual([
      [-0.8, -1],
      [0.8, -1],
      [0.8, 1],
      [-0.8, 1],
    ]);
    const wide = furniture.resolve('furniture.bed', { width: 1.8, color: '#e0e0e0' })!;
    expect(wide.size.width).toBe(1.8);
    expect(Math.max(...wide.footprint.map(([x]) => x))).toBeCloseTo(0.9);
    // A side rail of the frame: lacquer in the colour, which is lighter than oak (no stain).
    expect(wide.parts[1]!.color).toBe('#e0e0e0');
    // Invalid or design-only props are ignored, never thrown.
    expect(furniture.resolve('furniture.bed', { width: 9, height: 2, legs: [1] })!.size).toEqual(
      bed.size,
    );
    const table = furniture.resolve('furniture.table', { diameter: 1.4 })!;
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
