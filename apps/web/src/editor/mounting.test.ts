import type { HomeModel } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import { furniture } from '../catalog/furniture';
import { editorItem, mockHome } from '../test/fixtures';
import { elevationOfItem, mountingOfItem, type EditorItem } from './item';
import {
  collisions,
  createContext,
  createItem,
  duplicateItem,
  heightRange,
  issuesOf,
  mountHeightOf,
  moveItem,
  setElevation,
  setMounting,
} from './operations';

// The mock home's kitchen: x 1.5…5, z -4…0.5; the face of its 30 cm back wall at z = -3.85, of
// the 12 cm hall wall at x = 1.56. The ceiling is at 2.50.
const ctx = createContext(mockHome, furniture);
const kitchen = { levelId: 'souterrain', roomId: 'souterrain-kitchen' };

const place = (typeId: string, items: EditorItem[] = [], id = typeId) =>
  createItem(ctx, items, { id, typeId, ...kitchen });

describe('wall- and ceiling-mounted items (#63)', () => {
  it('hangs a new wall cabinet on a wall at its type’s height', () => {
    const cabinet = place('kitchen.wall-cabinet');
    expect(cabinet).toMatchObject({
      mounting: 'wall',
      elevation: 1.33,
      roomId: 'souterrain-kitchen',
    });
    expect(issuesOf(ctx, cabinet)).toMatchObject({ offWall: false, aboveCeiling: false });
    expect(heightRange(ctx, cabinet)).toEqual({ bottom: 1.33, top: 1.33 + 0.68 });
    // A downlight hangs at the ceiling; a bed stands on the floor (no fields: the defaults).
    const light = place('fixture.downlight');
    expect(light.mounting).toBe('ceiling');
    expect(light.elevation).toBeUndefined();
    expect(mountHeightOf(ctx, light)).toBe(2.5);
    const bed = createItem(ctx, [], { id: 'b', typeId: 'furniture.bed', levelId: 'souterrain' });
    expect('mounting' in bed || 'elevation' in bed).toBe(false);
  });

  it('moves a wall piece along its wall and onto the nearest wall, never off one', () => {
    const cabinet = editorItem({
      typeId: 'kitchen.wall-cabinet',
      mounting: 'wall',
      elevation: 1.33,
      ...kitchen,
      position: { x: 3, z: -3.675 },
    });
    // Dragged into the room: it stays on the back wall, flush, moved along it.
    const along = moveItem(ctx, cabinet, [4, -3.2]);
    expect(along.position.x).toBeCloseTo(4);
    expect(along.position.z).toBeCloseTo(-3.675);
    expect(along.rotationY).toBeCloseTo(0);
    // Near the hall wall: it turns its back to it.
    const turned = moveItem(ctx, cabinet, [1.9, -1.5]);
    expect(turned.position.x).toBeCloseTo(1.56 + 0.35 / 2);
    expect(Math.abs(turned.rotationY)).toBeCloseTo(Math.PI / 2);
    expect(issuesOf(ctx, turned).offWall).toBe(false);
    // In the middle of the room, more than 1 m from every wall: it does not move.
    expect(moveItem(ctx, cabinet, [3.3, -1.7])).toBe(cabinet);
  });

  it('a wall cabinet above a base cabinet does not collide; one lowered into it does', () => {
    const base = { ...place('kitchen.base-cabinet'), position: { x: 3.2, z: -3.55 }, rotationY: 0 };
    const cabinet = editorItem({
      id: 'wall',
      typeId: 'kitchen.wall-cabinet',
      mounting: 'wall',
      elevation: 1.33,
      ...kitchen,
      position: { x: 3.2, z: -3.675 },
    });
    expect(collisions(ctx, [base, cabinet]).size).toBe(0);
    const lowered = setElevation(ctx, cabinet, 0.5);
    expect([...collisions(ctx, [base, lowered]).keys()].sort()).toEqual([base.id, lowered.id]);
  });

  it('sets the height in whole centimetres, never under a ceiling, and flags it above the ceiling', () => {
    const cabinet = place('kitchen.wall-cabinet');
    expect(setElevation(ctx, cabinet, 1.4567).elevation).toBe(1.46);
    expect(setElevation(ctx, cabinet, -1).elevation).toBeUndefined(); // 0: the default
    const high = setElevation(ctx, cabinet, 2);
    expect(issuesOf(ctx, high).aboveCeiling).toBe(true);
    const light = place('fixture.downlight');
    expect(setElevation(ctx, light, 1)).toBe(light);
  });

  it('switches between the floor and a wall', () => {
    const cabinet = place('kitchen.wall-cabinet');
    const floor = setMounting(ctx, [cabinet], cabinet, 'floor');
    expect([mountingOfItem(floor), elevationOfItem(floor)]).toEqual(['floor', 0]);
    expect(setMounting(ctx, [cabinet], cabinet, 'ceiling')).toBe(cabinet);
    const shelf = editorItem({
      typeId: 'furniture.storage-shelf',
      ...kitchen,
      position: { x: 3, z: -3.2 },
    });
    const hung = setMounting(ctx, [shelf], shelf, 'wall');
    expect(hung.mounting).toBe('wall');
    expect(issuesOf(ctx, hung).offWall).toBe(false);
    // More than 1 m from every wall: it goes to a free spot on a wall of its room, never off one.
    const middle = { ...shelf, position: { x: 3.3, z: -1.7 } };
    const moved = setMounting(ctx, [middle], middle, 'wall');
    expect(moved).toMatchObject({ mounting: 'wall', roomId: 'souterrain-kitchen' });
    expect(issuesOf(ctx, moved).offWall).toBe(false);
    // On a level without any wall there is nowhere to hang it: nothing changes.
    const bare = createContext({ ...mockHome, walls: [] }, furniture);
    expect(setMounting(bare, [middle], middle, 'wall')).toBe(middle);
  });

  it('duplicates a wall piece next to it on the same wall, at the same height', () => {
    const cabinet = place('kitchen.wall-cabinet');
    const copy = duplicateItem(ctx, [cabinet], cabinet, 'copy');
    expect(copy).toMatchObject({ mounting: 'wall', elevation: 1.33, rotationY: cabinet.rotationY });
    expect(
      Math.hypot(copy.position.x - cabinet.position.x, copy.position.z - cabinet.position.z),
    ).toBeCloseTo(0.7);
    expect(collisions(ctx, [cabinet, copy]).size).toBe(0);
  });

  it('hangs a ceiling piece at a lowered ceiling and keeps a piece from moving under one too low', () => {
    const lowered = {
      ...mockHome,
      ceilings: [
        {
          id: 'box',
          name: 'Box',
          levelId: 'souterrain',
          outline: [
            [1.5, -1],
            [5, -1],
            [5, 0.5],
            [1.5, 0.5],
          ].map(([x, z]) => ({
            x: { value: x!, source: 'mock' },
            z: { value: z!, source: 'mock' },
          })),
          height: { value: 2, source: 'mock' },
        },
      ],
    } as HomeModel;
    const low = createContext(lowered, furniture);
    const light = editorItem({ typeId: 'fixture.downlight', mounting: 'ceiling', ...kitchen });
    expect(mountHeightOf(low, { ...light, position: { x: 3, z: -2 } })).toBe(2.5);
    expect(mountHeightOf(low, { ...light, position: { x: 3, z: 0 } })).toBe(2);
    // A wall cabinet at 1.40 (top 2.08) fits under 2.50 but not under the box.
    const cabinet = editorItem({
      typeId: 'kitchen.wall-cabinet',
      mounting: 'wall',
      elevation: 1.4,
      ...kitchen,
      position: { x: 4.85 - 0.35 / 2, z: -2 },
      rotationY: -Math.PI / 2,
    });
    expect(moveItem(low, cabinet, [4.8, 0])).toBe(cabinet);
    expect(moveItem(low, cabinet, [4.8, -2.5]).position.z).toBeCloseTo(-2.5);
  });
});
