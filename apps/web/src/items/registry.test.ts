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
      'Bedroom',
      'Dining',
      'Living room',
      'Office',
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
