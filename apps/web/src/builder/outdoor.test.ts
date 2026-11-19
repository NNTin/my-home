import { HomeModel } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import realHomeJson from '../../../../data/homes/home.json';
import { furniture } from '../catalog/furniture';
import type { EditorItem } from '../editor/item';
import { collisions, createContext, moveItem } from '../editor/operations';
import { buildHome, groundAt } from './buildHome';

const home = () => HomeModel.parse(structuredClone(realHomeJson));
const SOUTERRAIN = -2.6;

describe('the ground outdoor pieces stand on', () => {
  const scene = buildHome(home());
  const at = (x: number, z: number) => groundAt(scene.terrain, [x, z], SOUTERRAIN);

  it('is the terrain at the spot: the patio, the sunken landing, a step, the sloped south garden', () => {
    expect(at(18, -4)).toBe(-1.65);
    expect(at(14.5, -7.4)).toBe(-2.6);
    expect(at(16.2, -7.4)).toBe(-2.464);
    // The slope from the south garden down to the patio lies between its two levels.
    const slope = at(17, 0);
    expect(slope).toBeGreaterThan(-1.65);
    expect(slope).toBeLessThanOrEqual(-0.05);
  });

  it('falls back where no terrain is (inside the house)', () => {
    expect(at(10, -6.5)).toBe(SOUTERRAIN);
  });
});

describe('outdoor pieces in the editor', () => {
  const ctx = createContext(home(), furniture);
  const item = (id: string, typeId: string, x: number, z: number): EditorItem => ({
    id,
    typeId,
    levelId: 'souterrain',
    position: { x, z },
    rotationY: 0,
    params: {},
    name: '',
  });

  it('stay outside when dragged: never into the house, never onto the road', () => {
    const chair = item('c', 'garden.chair', 16, -4);
    expect(moveItem(ctx, chair, [17, -3]).position).toEqual({ x: 17, z: -3 });
    // Towards the bed room: it stops outside the facade (x 13.42).
    expect(moveItem(ctx, chair, [11, -4]).position.x).toBeGreaterThanOrEqual(13.42);
    // Through the lane fence onto the lane: it stays on the patio.
    expect(moveItem(ctx, chair, [21, -4]).position.x).toBeLessThan(19.3);
  });

  it('an open piece (a pergola, a stepping stone) collides with nothing under it', () => {
    const pergola = item('p', 'garden.pergola', 15, -9.5);
    const table = item('t', 'garden.table', 15, -9.5);
    const chair = item('c', 'garden.chair', 15, -9.5);
    expect([...collisions(ctx, [pergola, table]).keys()]).toEqual([]);
    expect([...collisions(ctx, [table, chair]).keys()].sort()).toEqual(['c', 't']);
  });

  it('are not offered by the "Add" panel, which adds to a room', () => {
    const offered = furniture.categories.flatMap((c) => c.types.map((t) => t.id));
    expect(offered.some((id) => id.startsWith('garden.'))).toBe(false);
    expect(furniture.get('garden.pergola')).toMatchObject({ outdoor: true, open: true });
    expect(furniture.get('garden.chair')).toMatchObject({ outdoor: true, open: false });
  });
});
