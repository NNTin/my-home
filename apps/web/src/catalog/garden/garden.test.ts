import { catalog, effectiveParams } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import { pieces } from '../registry';

const draw = (id: string, overrides: Record<string, unknown> = {}) => {
  const type = catalog.get(id)!;
  const { values } = effectiveParams(type, overrides);
  return pieces.get(id)!.parts(values, { width: 1, height: 1, wallDepth: 1 });
};

describe('garden pieces', () => {
  it('a shrub with roses carries flowers on its surface', () => {
    const plain = draw('garden.shrub');
    const roses = draw('garden.shrub', { flowers: 'roses' });
    const flowers = roses.filter((p) => p.role === 'detail');
    expect(flowers).toHaveLength(14);
    expect(plain.filter((p) => p.role === 'detail')).toHaveLength(0);
    expect(flowers.every((p) => p.color === '#c23b4e')).toBe(true);
    // Out on the bush, not hidden in it: at least as far out as the slice they sit on.
    for (const f of flowers) expect(Math.hypot(f.center[0], f.center[2])).toBeGreaterThan(0.1);
  });

  it('a pergola has its posts at the front and a roof falling to them', () => {
    const parts = draw('garden.pergola', { posts: 3 });
    const posts = parts.filter((p) => p.role === 'post');
    expect(posts).toHaveLength(3);
    expect(posts.every((p) => p.center[2] > 1.2)).toBe(true);
    const roof = parts.find((p) => p.role === 'panel')!;
    expect(roof.rotationX).toBeCloseTo(Math.atan2(2.45 - 2.15, 2.6));
    expect(roof.material).toMatchObject({ transparent: true });
  });

  it('a log lies on its side along its length', () => {
    const [trunk] = draw('garden.log');
    expect(trunk).toMatchObject({ shape: 'cylinder', rotationY: Math.PI / 2 });
    expect(trunk!.rotationX).toBeCloseTo(Math.PI / 2);
    expect(trunk!.center[1]).toBeCloseTo(0.35 / 2);
  });

  it('draws a dry-stone pile the same every time, within its size', () => {
    const a = draw('garden.rock-pile');
    expect(draw('garden.rock-pile')).toEqual(a);
    for (const stone of a) {
      expect(Math.abs(stone.center[0])).toBeLessThan(0.8);
      expect(stone.center[1] + stone.size[1] / 2).toBeLessThan(0.6 * 1.2);
    }
  });
});
