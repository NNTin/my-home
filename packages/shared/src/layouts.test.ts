import { describe, expect, it } from 'vitest';
import { formatIssues } from './home-model';
import { CreateLayoutBody, Layout, LayoutFile, type LayoutItem } from './layouts';

const item = (overrides: Partial<LayoutItem> = {}): LayoutItem => ({
  id: 'bed-1',
  typeId: 'bed',
  levelId: 'souterrain',
  roomId: 'souterrain-bedroom',
  position: { x: -3, z: 2.5 },
  rotationY: Math.PI / 2,
  props: {},
  ...overrides,
});

const layout = (items: LayoutItem[] = [item()]) => ({
  id: 'layout-1',
  homeId: 'mock-home',
  name: 'Default',
  schemaVersion: 1,
  version: 1,
  items,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('Layout', () => {
  it('accepts a layout with items and JSON props', () => {
    const parsed = Layout.parse(layout([item({ props: { color: '#fff', legs: [1, 2] } })]));
    expect(parsed.items[0]?.props).toEqual({ color: '#fff', legs: [1, 2] });
  });

  it('allows items without a room', () => {
    const noRoom: Partial<LayoutItem> = item();
    delete noRoom.roomId;
    expect(Layout.safeParse(layout([noRoom as LayoutItem])).success).toBe(true);
  });

  it('rejects duplicate item ids with a path', () => {
    const result = Layout.safeParse(layout([item(), item()]));
    expect(result.success).toBe(false);
    expect(formatIssues(result.error!)).toEqual([
      { path: 'items[1].id', message: 'Duplicate item id "bed-1" (already used by [0])' },
    ]);
  });

  it('rejects bad ids, missing fields and non-JSON props', () => {
    const bad = Layout.safeParse(
      layout([{ ...item({ id: 'has space' }), props: { f: () => 1 } } as unknown as LayoutItem]),
    );
    expect(formatIssues(bad.error!).map((i) => i.path)).toEqual(
      expect.arrayContaining(['items[0].id', 'items[0].props.f']),
    );
    const noPosition: Partial<LayoutItem> = item();
    delete noPosition.position;
    expect(Layout.safeParse(layout([noPosition as LayoutItem])).success).toBe(false);
  });
});

describe('CreateLayoutBody', () => {
  it('defaults items and trims the name', () => {
    expect(CreateLayoutBody.parse({ name: '  Living  ' })).toEqual({ name: 'Living', items: [] });
    expect(CreateLayoutBody.safeParse({ name: '   ' }).success).toBe(false);
  });
});

describe('LayoutFile', () => {
  it('accepts an exported layout (server fields are ignored)', () => {
    const file = LayoutFile.parse(layout());
    expect(file).toEqual({
      schemaVersion: 1,
      name: 'Default',
      homeId: 'mock-home',
      items: [item()],
    });
  });

  it('rejects another schema version', () => {
    expect(LayoutFile.safeParse({ ...layout(), schemaVersion: 2 }).success).toBe(false);
  });
});
