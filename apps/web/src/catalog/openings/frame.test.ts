import { catalog, defaultParams, effectiveParams, type OpeningType } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import type { Box } from '../../builder/buildHome';
import { pieces } from '../registry';
import type { Part, PieceContext } from '../types';

/**
 * The renderer before the piece modules (`openingParts` in the builder, with its constants and
 * the colours of `HomeMeshes`), kept verbatim as the reference the modules must reproduce.
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

const comparable = (p: Part) => ({
  center: p.center,
  size: p.size,
  rotationY: p.rotationY,
  color: p.color,
  glass: p.material?.transparent === true,
});

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

// The windows have their own design since #47 (`window.test.ts`); the doors still draw as before.
const wallTypes = catalog.types.filter((t) => t.placement === 'wall' && t.family !== 'window');

describe('frame parts', () => {
  it.each(wallTypes.map((t) => t.id))('%s at its defaults equals the old renderer', (id) => {
    const type = catalog.get(id)!;
    for (const [w, h, wallDepth] of holes) {
      const parts = partsOf(id, { width: w, height: h, wallDepth });
      const legacy = legacyOpeningParts(type.openingTypes![0]!, [w, h, wallDepth]);
      // Same boxes, colours and order, bit for bit.
      expect(parts.map(comparable)).toEqual(legacy);
    }
  });

  it('frames a window on four sides and adds glass', () => {
    const parts = partsOf('window.casement', { width: 1, height: 1, wallDepth: 0.3 });
    expect(parts.filter((p) => p.role === 'frame')).toHaveLength(4);
    const glass = parts.find((p) => p.role === 'glass')!;
    // Inside a 6.5 cm frame and a 6 cm sash on every side; double glazing 2.4 cm.
    expect(glass.size[0]).toBeCloseTo(1 - 2 * 0.065 - 2 * 0.06, 9);
    expect(glass.size[1]).toBeCloseTo(1 - 2 * 0.065 - 2 * 0.06, 9);
    expect(glass.size[2]).toBeCloseTo(0.024, 9);
    expect(glass.material).toEqual({ transparent: true, opacity: 0.35, depthWrite: false });
  });

  it('leaves a door open at the bottom', () => {
    const parts = partsOf('door.interior', { width: 1, height: 2, wallDepth: 0.3 });
    expect(parts).toHaveLength(3);
    expect(parts.every((p) => p.role === 'frame' && p.color === '#7b5a3c')).toBe(true);
  });

  it('glazes French doors to the floor and closes garage doors with a panel', () => {
    const french = partsOf('door.french', { width: 2, height: 2.2, wallDepth: 0.36 });
    expect(french.filter((p) => p.role === 'frame')).toHaveLength(3);
    expect(french.find((p) => p.role === 'glass')!.size[1]).toBeCloseTo(2.2 - 0.06);
    const garage = partsOf('door.garage', { width: 2.5, height: 2.1, wallDepth: 0.24 });
    expect(garage.filter((p) => p.role === 'frame')).toHaveLength(3);
    expect(garage.find((p) => p.role === 'glass')).toBeUndefined();
    const panel = garage.find((p) => p.role === 'panel')!;
    expect(panel.size[0]).toBeCloseTo(2.5 - 0.12);
    expect(panel.color).toBe('#8a8d90');
  });

  it.each([['door.french', 'leaves', 3]] as const)(
    '%s: more %s add a mullion between each two',
    (id, key, max) => {
      const ctx = { width: 2, height: 2.2, wallDepth: 0.36 };
      const one = partsOf(id, ctx);
      for (let n = 2; n <= max; n++) {
        const parts = partsOf(id, ctx, { [key]: n });
        expect(parts).toHaveLength(one.length + n - 1);
        // The first members and the fill are unchanged; the mullions go between them.
        const frames = one.filter((p) => p.role === 'frame').length;
        expect(parts.slice(0, frames)).toEqual(one.slice(0, frames));
        expect(parts.at(-1)).toEqual(one.at(-1));
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

  it('draws the roof window as one opaque pane that casts but does not receive shadows', () => {
    const type = catalog.get('window.roof')!;
    const parts = pieces.get('window.roof')!.parts(defaultParams(type), {
      width: 0.8,
      height: 1,
      wallDepth: 0.06,
    });
    expect(parts).toEqual([
      {
        shape: 'box',
        center: [0, 0, 0],
        size: [0.8, 0.06, 1],
        rotationY: 0,
        color: '#a8d4ff',
        role: 'glass',
        material: { metalness: 0.3, roughness: 0.2, receiveShadow: false },
      },
    ]);
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
