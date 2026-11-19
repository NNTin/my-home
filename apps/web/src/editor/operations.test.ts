import type { EditorItem } from './item';
import { describe, expect, it } from 'vitest';
import { furniture } from '../catalog/furniture';
import { editorItem, mockHome } from '../test/fixtures';
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

const ctx = createContext(mockHome, furniture);
const free = createContext(mockHome, furniture, {
  ...defaultSettings,
  grid: false,
  wallSnap: false,
});

describe('editor operations', () => {
  it('places a new item in the chosen room, avoiding other items', () => {
    const first = createItem(ctx, [], {
      id: 'a',
      typeId: 'furniture.bed',
      levelId: 'souterrain',
      roomId: 'souterrain-bedroom',
    });
    expect(first).toMatchObject({
      roomId: 'souterrain-bedroom',
      rotationY: 0,
      params: {},
      name: '',
    });
    const second = createItem(ctx, [first], {
      id: 'b',
      typeId: 'furniture.bed',
      levelId: 'souterrain',
      roomId: 'souterrain-bedroom',
    });
    expect(collisions(ctx, [first, second]).size).toBe(0);
  });

  it('moves with grid snapping and recomputes the room', () => {
    const bed = editorItem({ roomId: 'souterrain-bedroom' });
    const moved = moveItem(
      { ...ctx, settings: { ...ctx.settings, wallSnap: false } },
      bed,
      [-2.73, 2.31],
    );
    expect(moved.position.x).toBeCloseTo(-2.7);
    expect(moved.position.z).toBeCloseTo(2.3);
    const chair = editorItem({ typeId: 'furniture.chair', roomId: 'souterrain-bedroom' });
    const intoHall = moveItem(free, { ...chair, position: { x: -0.9, z: 2.45 } }, [0.5, 2.45]);
    expect(intoHall.roomId).toBe('souterrain-hallway');
  });

  it('snaps to walls when moving', () => {
    const moved = moveItem(ctx, editorItem(), [-4, 2.2]);
    expect(moved.position.x).toBeCloseTo(-4.05);
    expect(moved.position.z).toBeCloseTo(2.06);
    expect(collisions(ctx, [moved]).size).toBe(0);
  });

  it('sizes an item from its params: a wider bed snaps and collides with its own footprint', () => {
    const wide = { width: 1.8 };
    // Flush with the same wall: the left edge stays put, the centre moves by half the extra width.
    expect(moveItem(ctx, editorItem(), [-4, 2.2]).position.x).toBeCloseTo(-4.05);
    expect(moveItem(ctx, editorItem({ params: wide }), [-4, 2.2]).position.x).toBeCloseTo(-3.95);
    // Two beds 1.7 m apart: 1.6 m wide they fit side by side, 1.8 m wide they overlap.
    const pair = (params: EditorItem['params']) => [
      editorItem({ id: 'a', params, position: { x: -3.6, z: 2.06 } }),
      editorItem({ id: 'b', params, position: { x: -1.9, z: 2.06 } }),
    ];
    expect(collisions(ctx, pair({})).size).toBe(0);
    expect([...collisions(ctx, pair(wide)).keys()].sort()).toEqual(['a', 'b']);
  });

  it('keeps items inside the apartment', () => {
    const moved = moveItem(free, editorItem(), [-8, 2.5]);
    expect(moved.position).toEqual({ x: -3, z: 2.5 });
  });

  it('rotates in steps, or by 90° when rotation is free', () => {
    expect(rotateItem(ctx, editorItem(), 1).rotationY).toBeCloseTo(Math.PI / 2);
    expect(rotateItem(ctx, editorItem({ rotationY: 0.2 }), -1).rotationY).toBeCloseTo(-Math.PI / 2);
    const freeRotation = { ...ctx, settings: { ...ctx.settings, rotationStep: 0 } };
    expect(rotateItem(freeRotation, editorItem({ rotationY: 0 }), 1).rotationY).toBeCloseTo(
      Math.PI / 2,
    );
  });

  it('duplicates next to the original without overlapping it', () => {
    const chair = editorItem({ typeId: 'furniture.chair', position: { x: -3, z: 2.5 } });
    const copy = duplicateItem(ctx, [chair], chair, 'copy');
    expect(copy.id).toBe('copy');
    expect(copy.typeId).toBe('furniture.chair');
    expect(collisions(ctx, [chair, copy]).size).toBe(0);
  });

  it('flags overlapping items and walls', () => {
    const a = editorItem({ id: 'a' });
    const b = editorItem({ id: 'b', position: { x: -2.5, z: 2.5 } });
    const c = editorItem({ id: 'c', position: { x: -3, z: 1 } });
    const found = collisions(ctx, [a, b, c]);
    expect(found.get('a')?.itemIds).toEqual(expect.arrayContaining(['b', 'c']));
    expect(found.get('c')?.wallIds).toContain('souterrain-wall-living-bedroom');
  });

  it('flags items whose type, level or room no longer exists, without dropping them', () => {
    expect(issuesOf(ctx, editorItem({ roomId: 'souterrain-bedroom' }))).toEqual({
      unknownType: false,
      missingLevel: false,
      missingRoom: false,
      offWall: false,
      aboveCeiling: false,
    });
    expect(issuesOf(ctx, editorItem({ typeId: 'furniture.piano', roomId: 'gone' }))).toEqual({
      unknownType: true,
      missingLevel: false,
      missingRoom: true,
      offWall: false,
      aboveCeiling: false,
    });
    const orphan = editorItem({ levelId: 'attic', roomId: 'attic-room' });
    expect(issuesOf(ctx, orphan)).toMatchObject({ missingLevel: true, missingRoom: true });
    // Unknown levels are skipped by collision checks and moves leave such items unchanged.
    expect(collisions(ctx, [orphan]).size).toBe(0);
    expect(moveItem(ctx, orphan, [0, 0])).toBe(orphan);

    const rescued = relocateItem(ctx, [], orphan, 'souterrain', 'souterrain-bedroom');
    expect(rescued).toMatchObject({ levelId: 'souterrain', roomId: 'souterrain-bedroom' });
    expect(issuesOf(ctx, rescued).missingLevel).toBe(false);
  });
});
