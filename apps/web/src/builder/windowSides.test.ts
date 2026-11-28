import { HomeModel } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import mockHomeJson from '../../../../packages/shared/test-fixtures/mock-home.json';
import realHomeJson from '../../../../data/homes/home.json';
import { pointInPolygon } from '../geom/geometry';
import { buildHome } from './buildHome';
import type { Vec2 } from '../geom/types';
import { toOutline } from '../geom/plan';

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

describe('the curtain rod in the real home', () => {
  it('hangs under the ceiling in the living room (head 2.25, ceiling 2.35)', () => {
    const model = HomeModel.parse(structuredClone(realHomeJson));
    const id = 'window-souterrain-living-room-south';
    const opening = model.openings.find((o) => o.id === id)!;
    const level = model.levels.find((l) => l.id === 'souterrain')!;
    expect(opening.sill.value + opening.height.value).toBeCloseTo(2.25, 9);
    expect(level.height.value).toBeCloseTo(2.35, 9);
    const built = buildHome(model, new Map([[id, { curtain: 'right' }]])).openings.find(
      (o) => o.id === id,
    )!;
    const rod = built.parts.find((p) => p.role === 'curtain' && p.size[1] < 0.05)!;
    // Above the floor: the opening's centre height plus the rod's top in the opening's frame.
    const rodTop = opening.sill.value + opening.height.value / 2 + rod.center[1] + rod.size[1] / 2;
    expect(rodTop).toBeLessThanOrEqual(level.height.value - 0.03 + 1e-9);
    expect(rodTop).toBeGreaterThan(opening.sill.value + opening.height.value);
  });
});
