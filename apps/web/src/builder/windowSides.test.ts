import { HomeModel } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import mockHomeJson from '../../../../data/homes/mock-home.json';
import realHomeJson from '../../../../data/homes/home.json';
import { pointInPolygon } from '../editor/geometry';
import { buildHome, type Vec2 } from './buildHome';
import { toOutline } from './plan';

/** A part's centre on the plan: the opening's rotation about y (three.js), then its position. */
function planPoint(
  center: [number, number, number],
  at: [number, number, number],
  rotationY: number,
): Vec2 {
  const [x, , z] = center;
  const [c, s] = [Math.cos(rotationY), Math.sin(rotationY)];
  return [at[0] + x * c + z * s, at[2] - x * s + z * c];
}

describe.each([
  ['home', realHomeJson],
  ['mock-home', mockHomeJson],
])('wall windows of %s', (_id, json) => {
  const model = HomeModel.parse(structuredClone(json));
  const footprint = toOutline(model.building.footprint);
  const windows = buildHome(model).openings.filter((o) =>
    /^window\.(casement|tilt-turn)$/.test(o.typeId),
  );

  it('have their window board in the room and their outside sill outdoors, on every facade', () => {
    expect(windows.length).toBeGreaterThan(0);
    for (const o of windows) {
      const board = o.parts.find((p) => p.role === 'board')!;
      const sill = o.parts.find((p) => p.role === 'sill')!;
      expect(pointInPolygon(planPoint(board.center, o.center, o.rotationY), footprint), o.id).toBe(
        true,
      );
      expect(pointInPolygon(planPoint(sill.center, o.center, o.rotationY), footprint), o.id).toBe(
        false,
      );
    }
  });
});
