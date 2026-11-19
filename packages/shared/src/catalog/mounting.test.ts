import { describe, expect, it } from 'vitest';
import type { HomeModel } from '../home-model';
import { catalog } from './catalog';
import { heightFitIssues, mountHeight, mountingIssue, mountIssues, wallBehind } from './mounting';

const d = (value: number) => ({ value, source: 'mock' as const });
const pt = (x: number, z: number) => ({ x: d(x), z: d(z) });

// One room 4 x 3 m on level "l", a 20 cm wall along its north side (z = 0, face at z = 0.1),
// and a box lowering the ceiling to 2.00 over its west metre.
const model = {
  levels: [{ id: 'l', height: d(2.35) }],
  walls: [{ id: 'north', levelId: 'l', start: pt(0, 0), end: pt(4, 0), thickness: d(0.2) }],
  rooms: [{ id: 'room', levelId: 'l', outline: [pt(0, 0.1), pt(4, 0.1), pt(4, 3), pt(0, 3)] }],
  ceilings: [
    { id: 'box', levelId: 'l', outline: [pt(0, 0), pt(1, 0), pt(1, 3), pt(0, 3)], height: d(2) },
  ],
} as unknown as HomeModel;

const type = (id: string) => catalog.get(id)!;
const cabinet = type('kitchen.wall-cabinet');
const values = { width: 0.6, depth: 0.35, height: 0.68 };
// Back to the north wall: rotation 0 has the back at local -z, i.e. north.
const onWall = { levelId: 'l', x: 2, z: 0.1 + 0.35 / 2, rotationY: 0 };

describe('mounting', () => {
  it('finds the wall behind a piece flush against its face, parallel and alongside', () => {
    expect(wallBehind(model, onWall, 0.35)?.id).toBe('north');
    expect(wallBehind(model, { ...onWall, z: onWall.z + 0.02 }, 0.35)?.id).toBe('north');
    expect(wallBehind(model, { ...onWall, z: onWall.z + 0.1 }, 0.35)).toBeUndefined();
    expect(wallBehind(model, { ...onWall, rotationY: Math.PI / 2 }, 0.35)).toBeUndefined();
    expect(wallBehind(model, { ...onWall, x: 5 }, 0.35)).toBeUndefined();
    expect(wallBehind(model, { ...onWall, levelId: 'other' }, 0.35)).toBeUndefined();
  });

  it('flags a wall piece whose wall is gone and a ceiling piece outside every room', () => {
    expect(mountIssues(model, values, onWall, 'wall', 'room')).toEqual([]);
    expect(mountIssues({ ...model, walls: [] }, values, onWall, 'wall', 'room')).toEqual([
      'hangs on no wall (its wall is gone or moved)',
    ]);
    expect(mountIssues(model, values, onWall, 'floor', 'room')).toEqual([]);
    expect(mountIssues(model, {}, onWall, 'ceiling', 'room')).toEqual([]);
    expect(mountIssues(model, {}, onWall, 'ceiling', null)).toEqual([
      'no ceiling over it (outside every room)',
    ]);
  });

  it('hangs a ceiling piece at the lowered ceiling where there is one', () => {
    expect(mountHeight(model, { levelId: 'l', x: 2, z: 1 }, 'ceiling', 0)).toBe(2.35);
    expect(mountHeight(model, { levelId: 'l', x: 0.5, z: 1 }, 'ceiling', 0)).toBe(2);
    expect(mountHeight(model, { levelId: 'l', x: 0.5, z: 1 }, 'wall', 1.33)).toBe(1.33);
    expect(mountHeight(model, { levelId: 'x', x: 0.5, z: 1 }, 'ceiling', 0)).toBeUndefined();
  });

  it('checks the height against the ceiling over the piece', () => {
    expect(heightFitIssues(model, cabinet, values, onWall, 'wall', 1.33)).toEqual([]);
    expect(heightFitIssues(model, cabinet, values, onWall, 'wall', 1.7)).toEqual([
      'The wall cabinet (68.0 cm high, 170.0 cm above the floor) reaches above the ceiling at 235.0 cm',
    ]);
    // Under the box (2.00 m) the default 1.33 + 0.68 m is 1 cm too high.
    expect(
      heightFitIssues(model, cabinet, values, { ...onWall, x: 0.5 }, 'wall', 1.33),
    ).toHaveLength(1);
    expect(heightFitIssues(model, cabinet, values, onWall, 'ceiling', 5)).toEqual([]);
  });

  it('allows the type’s mountings only, and no elevation under a ceiling', () => {
    expect(mountingIssue(cabinet, 'floor', 0)).toBeUndefined();
    expect(mountingIssue(cabinet, 'ceiling', 0)).toBe(
      'A wall cabinet cannot be mounted under the ceiling',
    );
    const light = type('fixture.downlight');
    expect(mountingIssue(light, 'ceiling', 0)).toBeUndefined();
    expect(mountingIssue(light, 'wall', 0)).toBe('A downlight cannot be mounted on a wall');
    expect(mountingIssue(light, 'ceiling', 0.1)).toMatch(/no elevation/);
  });
});
