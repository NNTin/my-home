import { catalog, effectiveParams, furnitureSize } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import { partShape } from '../../builder/drawList';
import { boundsOf } from '../../piece-page/Inspector';
import { BUDGETS } from '../../quality/perfReport';
import { partBatches } from '../PartsMesh';
import { pieces } from '../registry';

/**
 * The appliances and the fixtures as rebuilt for docs/design/realistic-render.md step 6b:
 * fridge-freezer, microwave, radiator, downlight.
 */

function draw(id: string, overrides: Record<string, unknown> = {}) {
  const type = catalog.get(id)!;
  const { values } = effectiveParams(type, overrides);
  const size = furnitureSize(values);
  const ctx = { width: size.width, height: size.height, wallDepth: size.depth };
  const piece = pieces.get(id)!;
  return { parts: piece.parts(values, ctx), size, values, ctx, piece };
}

const CASES: [string, Record<string, unknown>, number][] = [
  ['appliance.fridge-freezer', {}, 1],
  ['appliance.fridge-freezer', { width: 0.75, height: 2.05, depth: 0.75 }, 1],
  ['appliance.fridge-freezer', { height: 1.2 }, 1],
  ['appliance.microwave', {}, 2],
  ['appliance.microwave', { width: 0.4, height: 0.24, depth: 0.3 }, 2],
  ['fixture.radiator', {}, 1],
  ['fixture.radiator', { width: 2, height: 0.9, depth: 0.2, valveSide: 'left' }, 1],
  ['fixture.radiator', { width: 0.4, height: 0.3, depth: 0.09 }, 1],
  ['fixture.downlight', {}, 1],
  ['fixture.downlight', { diameter: 0.2, light: 'daylight' }, 1],
];

describe('the appliances and fixtures', () => {
  it.each(CASES)(
    '%s %j names a finish on every part and is %i mesh(es), within a piece’s triangles',
    (id, overrides, meshCount) => {
      const { parts } = draw(id, overrides);
      expect(parts.filter((p) => !p.material?.finish)).toEqual([]);
      const meshes = partBatches(parts);
      expect(meshes).toHaveLength(meshCount);
      expect(meshes.reduce((n, m) => n + m.triangles, 0)).toBeLessThanOrEqual(
        BUDGETS.trianglesPerPiece,
      );
      for (const part of parts)
        for (const n of [...part.center, ...part.size]) expect(Number.isFinite(n)).toBe(true);
    },
  );

  it.each(CASES.filter(([id]) => id.startsWith('appliance.')))(
    '%s %j stands on its floor inside its footprint',
    (id, overrides) => {
      const { parts, size } = draw(id, overrides);
      const { min, max } = boundsOf(parts);
      expect(min[1]).toBeGreaterThanOrEqual(-1e-9);
      expect(max[1]).toBeLessThanOrEqual(size.height + 1e-9);
      expect(min[0]).toBeGreaterThanOrEqual(-size.width / 2 - 1e-9);
      expect(max[0]).toBeLessThanOrEqual(size.width / 2 + 1e-9);
      expect(min[2]).toBeGreaterThanOrEqual(-size.depth / 2 - 1e-9);
      // Handles and a dial stand off the front.
      expect(max[2]).toBeLessThanOrEqual(size.depth / 2 + 0.03 + 1e-9);
    },
  );

  it('the fridge has two doors with rounded edges that meet at the freezer height, over a kick strip', () => {
    const { parts, size } = draw('appliance.fridge-freezer');
    const doors = parts.filter((p) => p.role === 'leaf');
    expect(doors.map((p) => p.shape)).toEqual(['roundedBox', 'roundedBox']);
    const [fridge, freezer] = doors.map((p) => [
      p.center[1] - p.size[1] / 2,
      p.center[1] + p.size[1] / 2,
    ]);
    expect(fridge![1]).toBeCloseTo(size.height - 0.003);
    expect(fridge![0]).toBeCloseTo(0.703);
    expect(freezer![1]).toBeCloseTo(0.697);
    expect(freezer![0]).toBeCloseTo(0.043);
    const handles = parts.filter((p) => p.role === 'handle');
    expect(handles).toHaveLength(2);
    // Upright on the fridge door, lying on the freezer's.
    expect(handles[0]!.center[1]).toBeGreaterThan(0.7);
    expect(handles[1]!.center[1]).toBeLessThan(0.7);
    expect(handles.every((p) => p.material?.finish === 'plastic.matt')).toBe(true);
  });

  it.each([1.2, 1.25, 1.3, 1.85, 2.05])(
    'a fridge %s m high keeps its upright handle on the fridge door',
    (height) => {
      const { parts } = draw('appliance.fridge-freezer', { height });
      const [fridge] = parts.filter((p) => p.role === 'leaf');
      const [upright] = parts.filter((p) => p.role === 'handle');
      const door = boundsOf([fridge!]);
      const bar = boundsOf([upright!]);
      expect(bar.min[1]).toBeCloseTo(0.8);
      expect(bar.max[1]).toBeLessThanOrEqual(door.max[1] - 0.04);
      expect(bar.max[1] - bar.min[1]).toBeCloseTo(Math.min(0.5, height - 0.85));
    },
  );

  it('the microwave has a glass window and a control panel with a display, keys and a dial', () => {
    const { parts } = draw('appliance.microwave');
    expect(parts.filter((p) => p.material?.finish === 'glass.clear')).toHaveLength(2);
    expect(parts.filter((p) => p.role === 'handle' && p.shape === 'cylinder')).toHaveLength(1);
    const panel = parts.filter((p) => p.role === 'detail' && p.center[1] > 0.02);
    // The panel, the display and three rows of keys, all on the right of the window.
    expect(panel).toHaveLength(5);
    const window = parts.find((p) => p.role === 'glass')!;
    for (const p of panel)
      expect(p.center[0] - p.size[0] / 2).toBeGreaterThan(window.center[0] + window.size[0] / 2);
  });

  it('the radiator’s front panel is pressed into ribs across its width, whatever its size', () => {
    for (const width of [0.4, 0.75, 2]) {
      const { parts, size } = draw('fixture.radiator', { width });
      const ribs = parts.filter((p) => p.size[2] === 0.004);
      expect(ribs).toHaveLength(Math.floor((width - 0.03) / 0.033));
      const { min, max } = boundsOf(ribs);
      expect(min[0]).toBeGreaterThan(-width / 2);
      expect(max[0]).toBeLessThan(width / 2);
      // They are the radiator's front.
      expect(max[2]).toBeCloseTo(size.depth / 2);
      const all = boundsOf(parts);
      expect(all.max[2]).toBeCloseTo(size.depth / 2);
      expect(all.min[2]).toBeGreaterThanOrEqual(-size.depth / 2 - 1e-9);
      expect(all.max[1]).toBeCloseTo(size.height);
    }
  });

  it('the radiator\u2019s brackets reach the panel they carry, also when it has one panel only', () => {
    for (const depth of [0.09, 0.14, 0.2]) {
      const { parts, size } = draw('fixture.radiator', { depth });
      const brackets = parts.filter((p) => p.size[0] === 0.03 && p.size[1] === 0.06);
      expect(brackets).toHaveLength(2);
      // What stands at the brackets' front: the back face of the panel nearest the wall.
      const front = brackets[0]!.center[2] + brackets[0]!.size[2] / 2;
      const panels = parts.filter((p) => p.size[0] === size.width);
      const backs = panels.map((p) => p.center[2] - p.size[2] / 2);
      expect(Math.min(...backs)).toBeCloseTo(front);
      expect(brackets[0]!.center[2] - brackets[0]!.size[2] / 2).toBeCloseTo(-size.depth / 2);
    }
  });

  it('the radiator’s valve is on the side its use names, 5.5 cm past the end as before', () => {
    for (const [valveSide, sign] of [
      ['right', 1],
      ['left', -1],
    ] as const) {
      const { parts, size } = draw('fixture.radiator', { valveSide });
      const head = parts.find((p) => p.shape === 'lathe')!;
      expect(Math.sign(head.center[0])).toBe(sign);
      expect(head.center[1] + head.size[1] / 2).toBeCloseTo(size.height - 0.015);
      const { min, max } = boundsOf(parts);
      expect(sign > 0 ? max[0] : -min[0]).toBeCloseTo(size.width / 2 + 0.055);
      expect(sign > 0 ? min[0] : -max[0]).toBeCloseTo(-size.width / 2);
    }
  });

  it('the downlight’s trim is a closed ring under the ceiling, its lens sitting back in it', () => {
    for (const overrides of [{}, { diameter: 0.2 }, { diameter: 0.05 }]) {
      const { parts, values, ctx, piece } = draw('fixture.downlight', overrides);
      const [housing, ring, lens] = parts;
      expect(ring!.shape).toBe('lathe');
      expect(partShape(ring!).closed).toBe(true);
      const trim = Number(values.trim);
      expect(ring!.center[1] - ring!.size[1] / 2).toBeCloseTo(-trim);
      expect(ring!.center[1] + ring!.size[1] / 2).toBeCloseTo(0);
      expect(ring!.size[0]).toBeCloseTo(Number(values.diameter));
      // The housing is hidden above the ceiling's surface; the lens is under it, above the
      // trim's lower face, and fills the ring's opening.
      expect(housing!.center[1] - housing!.size[1] / 2).toBeCloseTo(0);
      expect(lens!.center[1] + lens!.size[1] / 2).toBeLessThan(0);
      expect(lens!.center[1] - lens!.size[1] / 2).toBeGreaterThan(-trim);
      expect(lens!.size[0]).toBeCloseTo(Number(values.diameter) * 0.72);
      // It emits what it emitted.
      expect(piece.emits!(values, ctx)).toEqual([
        { position: [0, -0.25, 0], color: '#fff0dc', intensity: 65, range: 6 },
      ]);
    }
  });
});
