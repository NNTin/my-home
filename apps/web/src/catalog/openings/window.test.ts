import { catalog, defaultParams, type ParamValues } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import type { Part, PieceContext } from '../types';
import { windowParts } from './window';

const ID = 'window.tilt-turn';
const values = (over: ParamValues = {}) => ({ ...defaultParams(catalog.get(ID)!), ...over });
const ctx = (outside: 1 | -1 = 1): PieceContext => ({
  width: 1.0,
  height: 1.0,
  wallDepth: 0.36,
  sill: 1.1,
  outside,
});
const of = (parts: Part[], role: Part['role']) => parts.filter((p) => p.role === role);
/** The z range of a part. */
const zs = (p: Part) => [p.center[2] - p.size[2] / 2, p.center[2] + p.size[2] / 2] as const;

describe('windowParts', () => {
  it('draws frame, sash, glass, handle, hinges, the window board and the outside sill', () => {
    const parts = windowParts(ID, values(), ctx());
    expect(of(parts, 'frame')).toHaveLength(4);
    expect(of(parts, 'sash')).toHaveLength(4);
    expect(of(parts, 'glass')).toHaveLength(1);
    expect(of(parts, 'handle')).toHaveLength(2);
    expect(of(parts, 'detail')).toHaveLength(2);
    expect(of(parts, 'board')).toHaveLength(1);
    expect(of(parts, 'sill')).toHaveLength(1);
    expect(of(parts, 'shutter')).toHaveLength(0);
    expect(of(parts, 'curtain')).toHaveLength(0);
    // uPVC and boards are lacquer, the pane is glass; the lever and the board have rounded edges.
    expect(
      parts.filter((p) => p.role !== 'glass').every((p) => p.material?.finish === 'plastic.matt'),
    ).toBe(true);
    expect(of(parts, 'glass')[0]!.material).toMatchObject({
      finish: 'glass.clear',
      transparent: true,
    });
    expect(parts.filter((p) => p.shape === 'roundedBox').map((p) => p.role)).toEqual([
      'handle',
      'board',
    ]);
    for (const p of parts)
      if (p.shape === 'roundedBox') expect(p.radius).toBeLessThanOrEqual(Math.min(...p.size) / 2);
  });

  it('a curtain is cloth, on a lacquered rod', () => {
    const parts = of(windowParts(ID, values({ curtain: 'both' }), ctx()), 'curtain');
    expect(parts.map((p) => p.material?.finish)).toEqual([
      'plastic.matt',
      'fabric.weave',
      'fabric.weave',
    ]);
  });

  it.each([1, -1] as const)(
    'puts the board in the room and the sill outdoors (outdoors at %i z)',
    (outside) => {
      const parts = windowParts(ID, values(), ctx(outside));
      const d = 0.36;
      const [board] = of(parts, 'board');
      const [sill] = of(parts, 'sill');
      const frame = of(parts, 'frame')[0]!;
      // Towards the outdoors, in local z: the sill beyond the facade, the board past the inner face.
      const out = (z: number) => z * outside;
      expect(Math.max(...zs(sill!).map(out))).toBeCloseTo(d / 2 + 0.05, 9);
      expect(Math.min(...zs(board!).map(out))).toBeCloseTo(-d / 2 - 0.03, 9);
      // The frame is set back 12 cm from the facade and 7 cm deep.
      expect(Math.max(...zs(frame).map(out))).toBeCloseTo(d / 2 - 0.12, 9);
      expect(Math.min(...zs(frame).map(out))).toBeCloseTo(d / 2 - 0.19, 9);
    },
  );

  it.each([2, 3, 4])(
    'adds a mullion between each two of %i sashes, each with its own sash',
    (n) => {
      const w = 2;
      const parts = windowParts(ID, values({ sashes: n }), { ...ctx(), width: w });
      const mullions = of(parts, 'frame').slice(4);
      expect(mullions).toHaveLength(n - 1);
      mullions.forEach((m, i) =>
        expect(m.center[0]).toBeCloseTo(-w / 2 + 0.065 + ((w - 0.13) * (i + 1)) / n, 9),
      );
      expect(of(parts, 'sash')).toHaveLength(4 * n);
      expect(of(parts, 'glass')).toHaveLength(n);
    },
  );

  it('puts the handle on the side the use asks for, as seen from the room', () => {
    const handleX = (over: ParamValues, outside: 1 | -1) =>
      of(windowParts(ID, values(over), ctx(outside)), 'handle')[0]!.center[0];
    // Seen from the room, right is -x when the outdoors is +z, and +x when it is -z.
    expect(handleX({ handleSide: 'right' }, 1)).toBeLessThan(0);
    expect(handleX({ handleSide: 'left' }, 1)).toBeGreaterThan(0);
    expect(handleX({ handleSide: 'right' }, -1)).toBeGreaterThan(0);
    // Two sashes: both handles towards the middle.
    const two = of(windowParts(ID, values({ sashes: 2 }), { ...ctx(), width: 1.6 }), 'handle');
    const plates = two.filter((h) => h.size[1] === 0.075).map((h) => h.center[0]);
    expect(plates).toHaveLength(2);
    expect(Math.abs(plates[0]!)).toBeLessThan(0.2);
    expect(Math.abs(plates[1]!)).toBeLessThan(0.2);
  });

  it('draws a roller shutter outside or inside, closed by its fraction', () => {
    const slats = (over: ParamValues) =>
      of(windowParts(ID, values(over), ctx()), 'shutter').filter(
        (p) => p.color === values().shutterColor,
      );
    expect(of(windowParts(ID, values({ shutter: 'outside' }), ctx()), 'shutter')).toHaveLength(3);
    expect(slats({ shutter: 'outside', shutterClosed: 0 })).toHaveLength(0);
    const [half] = slats({ shutter: 'outside', shutterClosed: 0.5 });
    expect(half!.size[1]).toBeCloseTo(0.5, 9);
    // Hanging from the top of the hole.
    expect(half!.center[1] + half!.size[1] / 2).toBeCloseTo(0.5, 9);
    // Box outside on the facade; inside a lid on the room side, the slats in the outer reveal.
    const box = (shutter: string) =>
      of(windowParts(ID, values({ shutter }), ctx()), 'shutter').find((p) => p.center[1] > 0.5)!;
    expect(zs(box('outside'))[0]).toBeCloseTo(0.18, 9);
    expect(zs(box('inside'))[1]).toBeCloseTo(-0.18, 9);
    const [inside] = slats({ shutter: 'inside', shutterClosed: 1 });
    expect(zs(inside!)[1]).toBeLessThan(0.18);
    expect(zs(inside!)[0]).toBeGreaterThan(0.06);
  });

  it('keeps the curtain rod under the ceiling when there is little room above the hole', () => {
    const rod = (headroom?: number) =>
      of(
        windowParts(ID, values({ curtain: 'both' }), {
          ...ctx(),
          ...(headroom !== undefined && { headroom }),
        }),
        'curtain',
      ).find((p) => p.size[1] < 0.05)!;
    const top = (p: Part) => p.center[1] + p.size[1] / 2;
    // Room to spare: 15 cm over the hole, as designed.
    expect(rod().center[1]).toBeCloseTo(0.5 + 0.15, 9);
    expect(rod(0.6).center[1]).toBeCloseTo(0.5 + 0.15, 9);
    // The living room: head 2.25, ceiling 2.35, so 10 cm. The rod's top stays 3 cm under the ceiling.
    expect(top(rod(0.1))).toBeCloseTo(0.5 + 0.1 - 0.03, 9);
    // The panels hang from the rod.
    const panels = of(
      windowParts(ID, values({ curtain: 'both' }), { ...ctx(), headroom: 0.1 }),
      'curtain',
    ).filter((p) => p.size[1] > 0.5);
    for (const p of panels) expect(top(p)).toBeLessThan(0.5 + 0.1);
    // No room at all: the rod sits on the hole's top instead of above it.
    expect(rod(0).center[1]).toBeCloseTo(0.5 + 0.011, 9);
  });

  it('hangs a curtain from a rod to the floor; closing widens the panels', () => {
    const panels = (over: ParamValues) =>
      of(windowParts(ID, values(over), ctx()), 'curtain').filter((p) => p.size[1] > 0.5);
    const open = panels({ curtain: 'both' });
    expect(open).toHaveLength(2);
    expect(open[0]!.center[1] - open[0]!.size[1] / 2).toBeCloseTo(-0.5 - 1.1 + 0.015, 9);
    const closed = panels({ curtain: 'both', curtainClosed: 1 });
    // Closed, the two panels meet in the middle of the 1.5 m rod.
    expect(closed[0]!.size[0]).toBeCloseTo(0.75, 9);
    expect(closed[0]!.size[0]).toBeGreaterThan(open[0]!.size[0]);
    // In the room, beyond the window board.
    for (const p of open) expect(zs(p)[1]).toBeLessThan(-0.18);
    // One panel on the left as seen from the room: +x when the outdoors is +z.
    expect(panels({ curtain: 'left' })[0]!.center[0]).toBeGreaterThan(0);
    expect(panels({ curtain: 'right' })[0]!.center[0]).toBeLessThan(0);
  });
});
