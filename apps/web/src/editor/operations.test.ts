import { describe, expect, it } from 'vitest';
import { registry } from '../items/registry';
import { layoutItem, mockHome } from '../test/fixtures';
import {
  collisions,
  createContext,
  createItem,
  defaultSettings,
  duplicateItem,
  issuesOf,
  moveItem,
  relocateItem,
  rotateItem,
} from './operations';

const ctx = createContext(mockHome, registry);
const free = createContext(mockHome, registry, {
  ...defaultSettings,
  grid: false,
  wallSnap: false,
});

describe('editor operations', () => {
  it('places a new item in the chosen room, avoiding other items', () => {
    const first = createItem(ctx, [], {
      id: 'a',
      typeId: 'bed',
      levelId: 'souterrain',
      roomId: 'souterrain-bedroom',
    });
    expect(first).toMatchObject({ roomId: 'souterrain-bedroom', rotationY: 0, props: {} });
    const second = createItem(ctx, [first], {
      id: 'b',
      typeId: 'bed',
      levelId: 'souterrain',
      roomId: 'souterrain-bedroom',
    });
    expect(collisions(ctx, [first, second]).size).toBe(0);
  });

  it('moves with grid snapping and recomputes the room', () => {
    const bed = layoutItem({ roomId: 'souterrain-bedroom' });
    const moved = moveItem(
      { ...ctx, settings: { ...ctx.settings, wallSnap: false } },
      bed,
      [-2.73, 2.31],
    );
    expect(moved.position.x).toBeCloseTo(-2.7);
    expect(moved.position.z).toBeCloseTo(2.3);
    const chair = layoutItem({ typeId: 'chair', roomId: 'souterrain-bedroom' });
    const intoHall = moveItem(free, { ...chair, position: { x: -0.9, z: 2.45 } }, [0.5, 2.45]);
    expect(intoHall.roomId).toBe('souterrain-hallway');
  });

  it('snaps to walls when moving', () => {
    const moved = moveItem(ctx, layoutItem(), [-4, 2.2]);
    expect(moved.position.x).toBeCloseTo(-4.05);
    expect(moved.position.z).toBeCloseTo(2.06);
    expect(collisions(ctx, [moved]).size).toBe(0);
  });

  it('keeps items inside the apartment', () => {
    const moved = moveItem(free, layoutItem(), [-8, 2.5]);
    expect(moved.position).toEqual({ x: -3, z: 2.5 });
  });

  it('rotates in steps, or by 90° when rotation is free', () => {
    expect(rotateItem(ctx, layoutItem(), 1).rotationY).toBeCloseTo(Math.PI / 2);
    expect(rotateItem(ctx, layoutItem({ rotationY: 0.2 }), -1).rotationY).toBeCloseTo(-Math.PI / 2);
    const freeRotation = { ...ctx, settings: { ...ctx.settings, rotationStep: 0 } };
    expect(rotateItem(freeRotation, layoutItem({ rotationY: 0 }), 1).rotationY).toBeCloseTo(
      Math.PI / 2,
    );
  });

  it('duplicates next to the original without overlapping it', () => {
    const chair = layoutItem({ typeId: 'chair', position: { x: -3, z: 2.5 } });
    const copy = duplicateItem(ctx, [chair], chair, 'copy');
    expect(copy.id).toBe('copy');
    expect(copy.typeId).toBe('chair');
    expect(collisions(ctx, [chair, copy]).size).toBe(0);
  });

  it('flags overlapping items and walls', () => {
    const a = layoutItem({ id: 'a' });
    const b = layoutItem({ id: 'b', position: { x: -2.5, z: 2.5 } });
    const c = layoutItem({ id: 'c', position: { x: -3, z: 1 } });
    const found = collisions(ctx, [a, b, c]);
    expect(found.get('a')?.itemIds).toEqual(expect.arrayContaining(['b', 'c']));
    expect(found.get('c')?.wallIds).toContain('souterrain-wall-living-bedroom');
  });

  it('flags items whose type, level or room no longer exists, without dropping them', () => {
    expect(issuesOf(ctx, layoutItem({ roomId: 'souterrain-bedroom' }))).toEqual({
      unknownType: false,
      missingLevel: false,
      missingRoom: false,
    });
    expect(issuesOf(ctx, layoutItem({ typeId: 'piano', roomId: 'gone' }))).toEqual({
      unknownType: true,
      missingLevel: false,
      missingRoom: true,
    });
    const orphan = layoutItem({ levelId: 'attic', roomId: 'attic-room' });
    expect(issuesOf(ctx, orphan)).toMatchObject({ missingLevel: true, missingRoom: true });
    // Unknown levels are skipped by collision checks and moves leave such items unchanged.
    expect(collisions(ctx, [orphan]).size).toBe(0);
    expect(moveItem(ctx, orphan, [0, 0])).toBe(orphan);

    const rescued = relocateItem(ctx, [], orphan, 'souterrain', 'souterrain-bedroom');
    expect(rescued).toMatchObject({ levelId: 'souterrain', roomId: 'souterrain-bedroom' });
    expect(issuesOf(ctx, rescued).missingLevel).toBe(false);
  });
});
