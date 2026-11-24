import { HomeModel } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import realHomeJson from '../../../../data/homes/home.json';
import { buildHome } from '../builder/buildHome';
import { groundGeometry, groundPlace, nearFor } from './Stage';

const home = buildHome(HomeModel.parse(structuredClone(realHomeJson)));

describe('the ground beyond the plot', () => {
  it('lies under the ground block, around the whole plot', () => {
    const { center, radius } = groundPlace(home);
    for (const t of home.terrain) {
      expect(center[1]).toBeLessThan(t.bottom);
      for (const [x, z] of t.outline)
        expect(Math.hypot(x - center[0], z - center[2])).toBeLessThanOrEqual(radius + 1e-9);
    }
  });

  it('is solid to its inner radius and fades to nothing at the outer one', () => {
    const g = groundGeometry(10, 24, '#808080');
    const position = g.getAttribute('position');
    const color = g.getAttribute('color');
    expect(color.itemSize).toBe(4);
    for (let i = 0; i < position.count; i++) {
      const r = Math.hypot(position.getX(i), position.getZ(i));
      expect(position.getY(i)).toBe(0);
      expect(color.getW(i)).toBe(r > 10.001 ? 0 : 1);
      if (r > 10.001) expect(r).toBeCloseTo(24);
    }
    // One mesh, a few hundred triangles.
    expect(g.index!.count / 3).toBeLessThan(400);
  });
});

describe('the near plane of a named view', () => {
  it('is the viewer’s own inside the scene and moves out with a camera far away', () => {
    expect(nearFor(10, 30)).toBe(0.1);
    expect(nearFor(30, 30)).toBe(0.1);
    expect(nearFor(80, 30)).toBeCloseTo(45);
    // Never beyond the nearest thing of the scene.
    expect(nearFor(120, 30)).toBeLessThan(120 - 30);
  });
});
