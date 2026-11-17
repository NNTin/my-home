import { catalog, defaultParams, furnitureSize, LEGACY_FURNITURE_TYPE_IDS } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import { createRegistry, registry } from './registry';
import { defineItemType, type ItemTypeModule } from './types';

const module = (overrides: Partial<ItemTypeModule> = {}) => ({
  default: defineItemType({
    id: 'lamp',
    name: 'Lamp',
    category: 'Lighting',
    icon: '💡',
    size: { width: 0.3, depth: 0.3, height: 1.5 },
    color: '#ffeeaa',
    snapping: { wall: 'none' },
    Render: () => null,
    ...overrides,
  }),
});

describe('item-type registry', () => {
  it('discovers every module folder in src/items', () => {
    expect(registry.types.map((t) => t.id).sort()).toEqual([
      'bed',
      'chair',
      'desk',
      'sofa',
      'table',
      'wardrobe',
    ]);
    expect(registry.categories.map((c) => c.name)).toEqual([
      'Bed room',
      'Dining',
      'Living room',
      'Work room',
    ]);
    expect(registry.get('bed')?.snapping.wall).toBe('back');
  });

  it('registers a new folder without other changes', () => {
    const r = createRegistry({
      './lamp/index.tsx': module(),
      './bed/index.tsx': module({ id: 'bed', category: 'Bedroom' }),
    });
    expect(r.get('lamp')?.name).toBe('Lamp');
    expect(r.categories.map((c) => c.name)).toEqual(['Bedroom', 'Lighting']);
  });

  it('defaults the footprint to the size rectangle', () => {
    const r = createRegistry({ './lamp/index.tsx': module() });
    expect(r.footprint(r.get('lamp')!)).toHaveLength(4);
    expect(registry.footprint(registry.get('table')!).length).toBeGreaterThan(4);
  });

  it('rejects invalid modules with the file path', () => {
    expect(() => createRegistry({ './lamp/index.tsx': {} })).toThrow(
      /lamp\/index.tsx: expected `export default/,
    );
    expect(() => createRegistry({ './light/index.tsx': module() })).toThrow(
      /"lamp" must equal the folder name "light"/,
    );
    expect(() =>
      createRegistry({ './lamp/index.tsx': module({ size: { width: 0, depth: 1, height: 1 } }) }),
    ).toThrow(/size/);
    expect(() =>
      createRegistry({
        './lamp/index.tsx': module({ snapping: { wall: 'sideways' as 'any' } }),
      }),
    ).toThrow(/snapping.wall/);
  });

  it('rejects duplicate ids', () => {
    expect(() =>
      createRegistry({ './lamp/index.tsx': module(), 'other/lamp/index.ts': module() }),
    ).toThrow(/Duplicate item type id "lamp"/);
  });
});

describe('item modules and the shared catalogue', () => {
  it('has a furniture.<id> type for every module, with its size and colour as defaults', () => {
    for (const module of registry.types) {
      const typeId = LEGACY_FURNITURE_TYPE_IDS[module.id];
      expect(typeId, module.id).toBe(`furniture.${module.id}`);
      const type = catalog.get(typeId!)!;
      expect(type, module.id).toBeDefined();
      expect(
        { name: type.name, category: type.category, icon: type.icon, snapping: type.snapping },
        module.id,
      ).toEqual({
        name: module.name,
        category: module.category,
        icon: module.icon,
        snapping: module.snapping,
      });
      expect(type.description, module.id).toBe(module.description);
      const values = defaultParams(type);
      expect(furnitureSize(values), module.id).toEqual(module.size);
      expect(values.color, module.id).toBe(module.color);
      expect(type.footprint, module.id).toBe(module.footprint ? 'ellipse' : 'rectangle');
    }
    expect(catalog.types.filter((t) => t.kind === 'furniture')).toHaveLength(registry.types.length);
  });
});
