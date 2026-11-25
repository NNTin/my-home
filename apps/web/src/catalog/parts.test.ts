import { Box3 } from 'three';
import { describe, expect, it } from 'vitest';
import { boundsOf } from '../piece-page/Inspector';
import { handle } from './cabinet';
import { partBatches } from './PartsMesh';
import { arc, plank, rod, roundedRect, slab, strip, veneerTint } from './parts';
import type { Part } from './types';

/**
 * The helpers the rebuilt pieces share (docs/design/realistic-render.md step 6b): outlines for
 * `extrude`, parts that lie down, and the stain of oak veneer.
 */

/** The box around a part as the viewer draws it, in the piece's frame. */
function drawn(part: Part) {
  const [mesh] = partBatches([part]);
  const box = new Box3().setFromBufferAttribute(mesh!.geometry.getAttribute('position') as never);
  const round = (v: { toArray(): number[] }) => v.toArray().map((n) => +n.toFixed(5));
  return { min: round(box.min), max: round(box.max) };
}

describe('outlines', () => {
  it('an arc runs from its first angle to its last on its circle', () => {
    const points = arc([1, 2], 0.5, 0, Math.PI / 2, 4);
    expect(points).toHaveLength(5);
    expect(points[0]).toEqual([1.5, 2]);
    expect(points[4]![0]).toBeCloseTo(1);
    expect(points[4]![1]).toBeCloseTo(2.5);
    for (const [x, y] of points) expect(Math.hypot(x - 1, y - 2)).toBeCloseTo(0.5);
  });

  it('a rounded rectangle fills its box and stays inside it', () => {
    const outline = roundedRect(0.8, 0.5, 0.05);
    const xs = outline.map((p) => p[0]);
    const ys = outline.map((p) => p[1]);
    expect([Math.min(...xs), Math.max(...xs)].map((n) => +n.toFixed(9))).toEqual([-0.4, 0.4]);
    expect([Math.min(...ys), Math.max(...ys)].map((n) => +n.toFixed(9))).toEqual([-0.25, 0.25]);
    // A corner is cut: no point of the outline lies in the box's own corner.
    expect(outline.some(([x, y]) => Math.abs(x) > 0.39 && Math.abs(y) > 0.24)).toBe(false);
  });

  it('a strip is as thick as its gauge along a straight run and at a mitred corner', () => {
    const outline = strip(
      [
        [0, 0],
        [0, 1],
        [2, 1],
      ],
      0.1,
    );
    expect(outline).toHaveLength(6);
    const rounded = outline.map((p) => p.map((n) => +n.toFixed(9)));
    // The left side of the way up and along, then back down the right side.
    expect(rounded).toEqual([
      [-0.05, 0],
      [-0.05, 1.05],
      [2, 1.05],
      [2, 0.95],
      [0.05, 0.95],
      [0.05, 0],
    ]);
  });
});

describe('parts that lie down', () => {
  it('a rod lies along x or along z about its middle', () => {
    expect(drawn(rod([1, 2, 3], 0.1, 0.8, '#112233', 'detail'))).toEqual({
      min: [0.6, 1.95, 2.95],
      max: [1.4, 2.05, 3.05],
    });
    expect(drawn(rod([1, 2, 3], 0.1, 0.8, '#112233', 'detail', 'z'))).toEqual({
      min: [0.95, 1.95, 2.6],
      max: [1.05, 2.05, 3.4],
    });
  });

  it('a slab lies flat: its thickness is up', () => {
    const part = slab([0, 1, 0.5], [0.8, 0.02, 0.5], 0.05, '#112233', 'detail');
    expect(part.shape).toBe('extrude');
    expect(drawn(part)).toEqual({ min: [-0.4, 0.99, 0.25], max: [0.4, 1.01, 0.75] });
  });

  it('a plank is the box it names, turned a quarter so that the grain runs along it', () => {
    const part = plank([0, 1, 0], [3, 0.04, 0.6], '#112233', 'board');
    expect(part.shape).toBe('box');
    expect(part.rotationY).toBe(Math.PI / 2);
    // The part's own z, along which the veneer's grain runs on a face that looks up, is its length.
    expect(part.size).toEqual([0.6, 0.04, 3]);
    expect(drawn(part)).toEqual({ min: [-1.5, 0.98, -0.3], max: [1.5, 1.02, 0.3] });
  });

  it('a handle stands off its front by the same reach lying and upright', () => {
    const lying = drawn(handle(0.2, 0.5, 0.3, 0.32, '#333333'));
    const upright = drawn(handle(0.2, 0.5, 0.3, 0.32, '#333333', true));
    expect([lying.min[0], lying.max[0]]).toEqual([0.04, 0.36]);
    expect([upright.min[1], upright.max[1]]).toEqual([0.34, 0.66]);
    for (const h of [lying, upright]) expect([h.min[2], h.max[2]]).toEqual([0.3, 0.33]);
    // The bar is a strip of metal: narrow where it is not long.
    expect(lying.max[1]! - lying.min[1]!).toBeCloseTo(0.011);
    expect(upright.max[0]! - upright.min[0]!).toBeCloseTo(0.011);
    expect(handle(0, 0, 0, 0.3, '#333333').material).toEqual({ finish: 'metal.brushed' });
  });

  it('the piece page frames a tilted or turned part by the box it is drawn in', () => {
    for (const part of [
      rod([1, 2, 3], 0.1, 0.8, '#112233', 'detail'),
      rod([1, 2, 3], 0.1, 0.8, '#112233', 'detail', 'z'),
      slab([0, 1, 0.5], [0.8, 0.02, 0.5], 0.05, '#112233', 'detail'),
      plank([0, 1, 0], [3, 0.04, 0.6], '#112233', 'board'),
      handle(0.2, 0.5, 0.3, 0.32, '#333333'),
      handle(0.2, 0.5, 0.3, 0.32, '#333333', true),
    ]) {
      const { min, max } = boundsOf([part]);
      expect({
        min: min.map((n) => +n.toFixed(5)),
        max: max.map((n) => +n.toFixed(5)),
      }).toEqual(drawn(part));
    }
  });
});

describe('the stain of oak veneer', () => {
  it('divides the colour by the oak: the oak itself is white, a dark brown a mid grey', () => {
    expect(veneerTint('#a17e57')).toBe('#ffffff');
    expect(veneerTint('#4b3a2d')).toBe('#777584');
    expect(veneerTint('#000000')).toBe('#000000');
  });

  it('has no stain for a colour lighter than oak in any channel', () => {
    expect(veneerTint('#ffffff')).toBeUndefined();
    expect(veneerTint('#a17e58')).toBeUndefined();
    expect(veneerTint('#c4c1ba')).toBeUndefined();
  });
});
