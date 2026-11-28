import { catalog, defaultParams, effectiveParams, type OpeningType } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import type { Box } from '../../geom/types';
import { veneerTint } from '../parts';
import { pieces } from '../registry';
import type { Part, PieceContext } from '../types';

/**
 * The renderer before the piece modules (`openingParts` in the builder, with its constants and
 * the colours of the old `HomeMeshes`), kept verbatim as the reference the modules must reproduce.
 */
function legacyOpeningParts(type: OpeningType, [w, h, wallDepth]: [number, number, number]) {
  const FRAME_WIDTH = 0.06;
  const FRAME_DEPTH = 0.1;
  const GLASS_DEPTH = 0.02;
  const f = Math.min(FRAME_WIDTH, w / 4, h / 4);
  const d = Math.min(FRAME_DEPTH, wallDepth);
  const box = (x: number, y: number, sx: number, sy: number, sz = d): Box => ({
    center: [x, y, 0],
    size: [sx, sy, sz],
    rotationY: 0,
  });
  const frame = [
    box(-w / 2 + f / 2, 0, f, h),
    box(w / 2 - f / 2, 0, f, h),
    box(0, h / 2 - f / 2, w - 2 * f, f),
  ];
  const frameColor = type === 'door' ? '#7b5a3c' : '#f7f7f5';
  const parts = (boxes: Box[], color: string, glass = false) =>
    boxes.map((b) => ({ ...b, color, glass }));
  if (type === 'door') return parts(frame, frameColor);
  if (type === 'french-door') {
    return [
      ...parts(frame, frameColor),
      ...parts([box(0, -f / 2, w - 2 * f, h - f, GLASS_DEPTH)], '#a8d4ff', true),
    ];
  }
  if (type === 'garage-door') {
    return [
      ...parts(frame, frameColor),
      ...parts([box(0, -f / 2, w - 2 * f, h - f, GLASS_DEPTH * 2)], '#8a8d90'),
    ];
  }
  frame.push(box(0, -h / 2 + f / 2, w - 2 * f, f));
  return [
    ...parts(frame, frameColor),
    ...parts([box(0, 0, w - 2 * f, h - 2 * f, GLASS_DEPTH)], '#a8d4ff', true),
  ];
}

/** A part's place and size: its colour is the stain now, and it has a finish. */
const comparable = (p: Part) => ({ center: p.center, size: p.size, rotationY: p.rotationY });

const partsOf = (typeId: string, ctx: PieceContext, overrides?: object) => {
  const type = catalog.get(typeId)!;
  return pieces.get(typeId)!.parts(effectiveParams(type, overrides).values, ctx);
};

const holes: [number, number, number][] = [
  [1, 1, 0.3],
  [1.2, 1.4, 0.36],
  [0.6, 0.8, 0.24],
  [0.12, 0.2, 0.36], // the frame clamps to a quarter of the hole
  [2, 2.2, 0.06], // a wall thinner than the frame
  [2.5, 2.1, 0.24],
];

// The windows have their own design since #47 (`window.test.ts`); the doors keep the frame of before.
const wallTypes = catalog.types.filter((t) => t.placement === 'wall' && t.family !== 'window');

describe('frame parts', () => {
  it.each(wallTypes.map((t) => t.id))(
    '%s: the frame\u2019s members stand where the old renderer put them',
    (id) => {
      const type = catalog.get(id)!;
      for (const [w, h, wallDepth] of holes) {
        const parts = partsOf(id, { width: w, height: h, wallDepth });
        const legacy = legacyOpeningParts(type.openingTypes![0]!, [w, h, wallDepth]).slice(0, 3);
        // The jambs and the head first: same boxes and order, bit for bit.
        expect(parts.slice(0, 3).map(comparable)).toEqual(
          legacy.map(({ center, size, rotationY }) => ({ center, size, rotationY })),
        );
        expect(parts.slice(0, 3).every((p) => p.role === 'frame')).toBe(true);
        // Nothing reaches out of the hole, or out of the wall but a handle (3 cm).
        for (const p of parts) {
          expect(Math.abs(p.center[0]) + p.size[0] / 2).toBeLessThanOrEqual(w / 2 + 1e-9);
          expect(Math.abs(p.center[1]) + p.size[1] / 2).toBeLessThanOrEqual(h / 2 + 1e-9);
          if (p.role !== 'handle')
            expect(Math.abs(p.center[2]) + p.size[2] / 2).toBeLessThanOrEqual(wallDepth / 2 + 1e-9);
        }
        expect(parts.every((p) => p.material?.finish)).toBe(true);
      }
    },
  );

  it('frames a window on four sides and adds glass', () => {
    const parts = partsOf('window.casement', { width: 1, height: 1, wallDepth: 0.3 });
    expect(parts.filter((p) => p.role === 'frame')).toHaveLength(4);
    const glass = parts.find((p) => p.role === 'glass')!;
    // Inside a 6.5 cm frame and a 6 cm sash on every side; double glazing 2.4 cm.
    expect(glass.size[0]).toBeCloseTo(1 - 2 * 0.065 - 2 * 0.06, 9);
    expect(glass.size[1]).toBeCloseTo(1 - 2 * 0.065 - 2 * 0.06, 9);
    expect(glass.size[2]).toBeCloseTo(0.024, 9);
    expect(glass.material).toEqual({
      finish: 'glass.clear',
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
  });

  it('leaves a door open at the bottom: its frame, and the stop the leaf closes against', () => {
    const parts = partsOf('door.interior', { width: 1, height: 2, wallDepth: 0.3 });
    expect(parts.map((p) => p.role)).toEqual([
      'frame',
      'frame',
      'frame',
      'detail',
      'detail',
      'detail',
    ]);
    // A brown frame is oak veneer stained to its colour.
    expect(parts.every((p) => p.color === veneerTint('#7b5a3c'))).toBe(true);
    expect(parts.every((p) => p.material?.finish === 'wood.veneer')).toBe(true);
    const [left, right, head] = parts.slice(3);
    // 1.5 cm inside each jamb and under the head, a third of the frame deep.
    expect(left!.center[0] - left!.size[0] / 2).toBeCloseTo(-0.5 + 0.06);
    expect(right!.center[0] + right!.size[0] / 2).toBeCloseTo(0.5 - 0.06);
    expect(head!.center[1] + head!.size[1] / 2).toBeCloseTo(1 - 0.06);
    expect(left!.size[2]).toBeCloseTo(0.1 / 3);
    expect(left!.center[1] - left!.size[1] / 2).toBeCloseTo(-1);
    // A white frame is lacquer.
    const white = partsOf(
      'door.interior',
      { width: 1, height: 2, wallDepth: 0.3 },
      { frameColor: '#f7f7f5' },
    );
    expect(white.every((p) => p.color === '#f7f7f5' && p.material?.finish === 'plastic.matt')).toBe(
      true,
    );
  });

  it('glazes French doors to the floor, a leaf at a time, and closes garage doors with sections', () => {
    const french = partsOf('door.french', { width: 2, height: 2.2, wallDepth: 0.36 });
    expect(french.filter((p) => p.role === 'frame')).toHaveLength(3);
    // One leaf: two stiles, a top rail and a bottom rail twice as high; a handle; the pane last.
    const sash = french.filter((p) => p.role === 'sash');
    expect(sash).toHaveLength(4);
    expect(sash[3]!.size[1]).toBeCloseTo(2 * sash[2]!.size[1]);
    expect(sash[3]!.center[1] - sash[3]!.size[1] / 2).toBeCloseTo(-1.1);
    expect(french.filter((p) => p.role === 'handle')).toHaveLength(1);
    const glass = french.at(-1)!;
    expect(glass.role).toBe('glass');
    expect(glass.material).toMatchObject({
      finish: 'glass.clear',
      transparent: true,
      opacity: 0.35,
    });
    expect(glass.size[0]).toBeCloseTo(2 - 0.12 - 0.18);
    expect(glass.size[1]).toBeCloseTo(2.2 - 0.06 - 0.27);
    const two = partsOf('door.french', { width: 2, height: 2.2, wallDepth: 0.36 }, { leaves: 2 });
    expect(two.filter((p) => p.role === 'glass')).toHaveLength(2);
    expect(two.slice(-2).every((p) => p.role === 'glass')).toBe(true);
    // The two leaves close in the middle: their handles stand on both sides of the mullion.
    expect(two.filter((p) => p.role === 'handle').map((p) => Math.sign(p.center[0]))).toEqual([
      -1, 1,
    ]);
    const garage = partsOf('door.garage', { width: 2.5, height: 2.1, wallDepth: 0.24 });
    expect(garage.filter((p) => p.role === 'frame')).toHaveLength(3);
    expect(garage.find((p) => p.role === 'glass')).toBeUndefined();
    // A dark backing, then four sections of about half a metre with joints between them.
    const [backing, ...sections] = garage.filter((p) => p.role === 'panel');
    expect(sections).toHaveLength(4);
    expect(backing!.size[1]).toBeCloseTo(2.1 - 0.06);
    for (const panel of sections) {
      expect(panel.size[0]).toBeCloseTo(2.5 - 0.12);
      expect(panel.size[1]).toBeCloseTo((2.1 - 0.06) / 4 - 0.012);
      expect(panel.size[2]).toBeCloseTo(0.04);
      expect(panel.color).toBe('#8a8d90');
    }
  });

  it.each([['door.french', 'leaves', 3]] as const)(
    '%s: more %s add a mullion between each two',
    (id, key, max) => {
      const ctx = { width: 2, height: 2.2, wallDepth: 0.36 };
      const one = partsOf(id, ctx);
      for (let n = 2; n <= max; n++) {
        const parts = partsOf(id, ctx, { [key]: n });
        // A mullion, and a leaf's four members, handle and pane, for each leaf more.
        expect(parts).toHaveLength(one.length + (n - 1) * 7);
        const frames = one.filter((p) => p.role === 'frame').length;
        expect(parts.slice(0, frames)).toEqual(one.slice(0, frames));
        const mullions = parts.slice(frames, frames + n - 1);
        expect(mullions.every((p) => p.role === 'frame' && p.color === one[0]!.color)).toBe(true);
        // Evenly spaced across the inside of the frame.
        const inner = 2 - 2 * 0.06;
        mullions.forEach((m, i) =>
          expect(m.center[0]).toBeCloseTo(-1 + 0.06 + (inner * (i + 1)) / n),
        );
      }
    },
  );

  it('falls back to the largest count that fits instead of throwing', () => {
    // 4 sashes need 1 m (0.25 m each); 0.6 m fits 2.
    const parts = partsOf(
      'window.casement',
      { width: 0.6, height: 1, wallDepth: 0.3 },
      { sashes: 4 },
    );
    expect(parts.filter((p) => p.role === 'frame')).toHaveLength(4 + 1);
    // A hole narrower than one sash still gets one.
    const narrow = partsOf(
      'window.casement',
      { width: 0.2, height: 1, wallDepth: 0.3 },
      { sashes: 3 },
    );
    expect(narrow.filter((p) => p.role === 'frame')).toHaveLength(4);
    // 3 leaves need 1.2 m (0.4 m each); 1 m fits 2.
    const french = partsOf(
      'door.french',
      { width: 1, height: 2.2, wallDepth: 0.36 },
      { leaves: 3 },
    );
    expect(french.filter((p) => p.role === 'frame')).toHaveLength(3 + 1);
  });

  it('draws the roof window as one opaque pane in a frame of cladding; the pane casts but does not receive shadows', () => {
    const type = catalog.get('window.roof')!;
    const parts = pieces.get('window.roof')!.parts(defaultParams(type), {
      width: 0.8,
      height: 1,
      wallDepth: 0.06,
    });
    expect(parts.map((p) => p.role)).toEqual(['frame', 'frame', 'frame', 'frame', 'glass']);
    expect(parts.at(-1)).toEqual({
      shape: 'box',
      center: [0, 0, 0],
      size: [0.8 - 0.1, 0.06, 1 - 0.1],
      rotationY: 0,
      color: '#a8d4ff',
      role: 'glass',
      material: { metalness: 0.3, roughness: 0.2, receiveShadow: false },
    });
    // The frame fills the hole around the pane and stands a centimetre proud of it.
    for (const member of parts.slice(0, 4)) {
      expect(Math.abs(member.center[0]) + member.size[0] / 2).toBeLessThanOrEqual(0.4 + 1e-9);
      expect(Math.abs(member.center[2]) + member.size[2] / 2).toBeLessThanOrEqual(0.5 + 1e-9);
      expect(member.center[1] + member.size[1] / 2).toBeCloseTo(0.04);
      expect(member.material).toEqual({ finish: 'plastic.matt' });
    }
  });

  it('measures the hole, the frame and the sashes', () => {
    const type = catalog.get('window.casement')!;
    const lines = pieces
      .get('window.casement')!
      .dimensions(
        { ...defaultParams(type), sashes: 2 },
        { width: 1.2, height: 1.4, wallDepth: 0.36, sill: 0.9 },
      );
    expect(lines.map((l) => `${l.name}: ${l.label}`)).toEqual([
      'Width: 120.0 cm',
      'Height: 140.0 cm',
      'Sill height: 90.0 cm',
      'Frame width: 6.5 cm',
      'Sash 1 width: 50.2 cm',
      'Sash 2 width: 50.2 cm',
    ]);
  });
});
