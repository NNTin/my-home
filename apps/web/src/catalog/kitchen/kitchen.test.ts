import { catalog, effectiveParams, furnitureSize, HomeSeed } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import seedJson from '../../../../../data/homes/home.seed.json';
import { boundsOf } from '../../piece-page/Inspector';
import { BUDGETS } from '../../quality/perfReport';
import { partBatches } from '../../scene/PartsMesh';
import { veneerTint } from '../parts';
import { pieces } from '../registry';
import type { Part } from '../types';

/** The kitchen family as rebuilt for docs/design/realistic-render.md step 6b. */

const TYPES = [
  'kitchen.base-cabinet',
  'kitchen.wall-cabinet',
  'kitchen.tall-cabinet',
  'kitchen.wall-shelf',
];

function draw(id: string, overrides: Record<string, unknown> = {}) {
  const type = catalog.get(id)!;
  const { values } = effectiveParams(type, overrides);
  const size = furnitureSize(values);
  const ctx = { width: size.width, height: size.height, wallDepth: size.depth };
  return { parts: pieces.get(id)!.parts(values, ctx), size, values, ctx };
}

/** A part's extent along x and y, for the parts that are not turned (fronts, the oven). */
const rect = (p: Part) => ({
  x: [p.center[0] - p.size[0] / 2, p.center[0] + p.size[0] / 2] as const,
  y: [p.center[1] - p.size[1] / 2, p.center[1] + p.size[1] / 2] as const,
});
const overlap = (a: readonly [number, number], b: readonly [number, number]) =>
  Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > 1e-9;
const finishesOf = (parts: Part[]) => [...new Set(parts.map((p) => p.material?.finish))].sort();

/** What the home places, and the extremes a use may choose. */
const placed = HomeSeed.parse(structuredClone(seedJson))
  .placements.filter((p) => TYPES.includes(p.typeId))
  .map((p) => [p.typeId, p.params ?? {}] as [string, Record<string, unknown>]);
const EXTREMES: [string, Record<string, unknown>][] = [
  [
    'kitchen.base-cabinet',
    {
      width: 4.2,
      unitWidth: 0.3,
      fronts: 'drawers',
      sink: 'single',
      sinkAt: 0.6,
      hob: 'downdraft',
      hobAt: 2,
      oven: 'built-in',
      ovenAt: 3.5,
    },
  ],
  ['kitchen.base-cabinet', { width: 0.3, oven: 'built-in', sink: 'single', hob: 'induction' }],
  ['kitchen.wall-cabinet', { width: 1.8, doors: 4, frontStyle: 'handle' }],
  ['kitchen.tall-cabinet', { door: 'solid' }],
  ['kitchen.wall-shelf', { width: 4.2, rail: 'hooks', finish: 'wood.veneer' }],
];

describe('the kitchen pieces', () => {
  it('the home places kitchen pieces', () => {
    expect(placed.length).toBeGreaterThanOrEqual(7);
  });

  it.each([
    ...TYPES.map((id) => [id, {}] as [string, Record<string, unknown>]),
    ...placed,
    ...EXTREMES,
  ])(
    '%s %j stays in its footprint, on its floor, within a piece’s triangles and four meshes',
    (id, overrides) => {
      const { parts, size } = draw(id, overrides);
      const { min, max } = boundsOf(parts);
      expect(min[0]).toBeGreaterThanOrEqual(-size.width / 2 - 1e-9);
      expect(max[0]).toBeLessThanOrEqual(size.width / 2 + 1e-9);
      expect(min[2]).toBeGreaterThanOrEqual(-size.depth / 2 - 1e-9);
      // Handles stand 3 cm off a front; a base unit's fronts stand back under the worktop.
      expect(max[2]).toBeLessThanOrEqual(size.depth / 2 + 0.03 + 1e-9);
      // A shelf's rail hangs below its board; everything else starts at the piece's bottom.
      if (id !== 'kitchen.wall-shelf') expect(min[1]).toBeGreaterThanOrEqual(-1e-9);
      const meshes = partBatches(parts);
      expect(meshes.reduce((n, m) => n + m.triangles, 0)).toBeLessThanOrEqual(
        BUDGETS.trianglesPerPiece,
      );
      expect(meshes.length).toBeLessThanOrEqual(4);
      for (const part of parts)
        for (const n of [...part.center, ...part.size]) expect(Number.isFinite(n)).toBe(true);
    },
  );

  it('every part names a finish: no part of a kitchen piece is a mesh of its own', () => {
    for (const [id, overrides] of [...placed, ...EXTREMES]) {
      const { parts } = draw(id, overrides);
      expect(
        parts.filter((p) => !p.material?.finish),
        id,
      ).toEqual([]);
    }
  });

  describe('base cabinet', () => {
    const base = (overrides: Record<string, unknown> = {}) =>
      draw('kitchen.base-cabinet', overrides);
    const fronts = (parts: Part[]) => parts.filter((p) => p.role === 'leaf');

    it('without an oven the units share the whole run', () => {
      const { parts } = base({ width: 2.4, unitWidth: 0.6, fronts: 'doors' });
      expect(fronts(parts)).toHaveLength(4);
      expect(parts.filter((p) => p.role === 'handle')).toHaveLength(4);
      for (const f of fronts(parts)) expect(f.size[0]).toBeCloseTo(0.6 - 0.003);
    });

    it('an oven is a unit of its own: fronts and handles stand beside it, a blind under it', () => {
      const { parts } = base({
        width: 3.38,
        unitWidth: 0.56,
        oven: 'built-in',
        ovenAt: 2.3,
        fronts: 'doors',
      });
      const oven = rect(parts.find((p) => p.role === 'body' && p.size[0] === 0.596)!);
      expect(oven.x[0]).toBeCloseTo(2.3 - 3.38 / 2 - 0.298);
      const beside = fronts(parts).filter((f) => !overlap(rect(f).x, oven.x));
      const under = fronts(parts).filter((f) => overlap(rect(f).x, oven.x));
      // 2.0 m to the left in four units, 0.78 m to the right in one; the blind.
      expect(beside).toHaveLength(5);
      expect(under).toHaveLength(1);
      expect(rect(under[0]!).y[1]).toBeLessThanOrEqual(oven.y[0] + 1e-9);
      expect(beside[0]!.size[0]).toBeCloseTo(2.002 / 4 - 0.003);
      expect(beside[4]!.size[0]).toBeCloseTo(0.782 - 0.003);
      // The oven's own handle is the only one in front of it.
      const handles = parts.filter((p) => p.role === 'handle');
      expect(handles).toHaveLength(6);
      for (const h of handles.slice(0, 5)) {
        const b = boundsOf([h]);
        expect(overlap([b.min[0], b.max[0]], oven.x)).toBe(false);
      }
    });

    it('an oven at the end of the run leaves one stretch, and a strip too narrow for a unit has no handle', () => {
      const end = base({
        width: 2,
        oven: 'built-in',
        ovenAt: 0.3,
        fronts: 'doors',
        unitWidth: 0.7,
      });
      expect(fronts(end.parts)).toHaveLength(3);
      const strip = base({
        width: 2,
        oven: 'built-in',
        ovenAt: 0.4,
        fronts: 'doors',
        unitWidth: 0.7,
      });
      const narrow = fronts(strip.parts).filter((f) => f.size[0] < 0.15);
      expect(narrow).toHaveLength(1);
      // Two units and the oven have a handle each.
      expect(strip.parts.filter((p) => p.role === 'handle')).toHaveLength(3);
    });

    it('the unit width that is measured is the first stretch’s', () => {
      const { values, ctx } = base({ width: 3.38, unitWidth: 0.56, oven: 'built-in', ovenAt: 2.3 });
      const lines = pieces.get('kitchen.base-cabinet')!.dimensions(values, ctx);
      const unit = lines.find((l) => l.name === 'Unit width')!;
      expect(unit.value).toBeCloseTo(2.002 / 4);
      expect(lines[0]!.value).toBe(3.38);
    });

    it('the worktop is oak veneer stained to its colour, its grain along the run; a light one is lacquer', () => {
      const wood = base().parts.find((p) => p.role === 'board')!;
      expect(wood.material).toEqual({ finish: 'wood.veneer' });
      expect(wood.color).toBe(veneerTint('#4b3a2d'));
      expect(wood.rotationY).toBe(Math.PI / 2);
      const white = base({ worktopColor: '#f2f2f2' }).parts.find((p) => p.role === 'board')!;
      expect(white.material).toEqual({ finish: 'plastic.matt' });
      expect(white.color).toBe('#f2f2f2');
    });

    it('draws laminate, metal and veneer, and glass only for a hob or an oven', () => {
      expect(finishesOf(base().parts)).toEqual(['metal.brushed', 'plastic.matt', 'wood.veneer']);
      expect(finishesOf(base({ hob: 'induction' }).parts)).toEqual([
        'glass.clear',
        'metal.brushed',
        'plastic.matt',
        'wood.veneer',
      ]);
    });

    it('a sink has a rim, a bowl with its drain, grooves and a tap that rises behind the bowl', () => {
      const { parts, size } = base({ sink: 'single', sinkAt: 1.7, width: 2.095 });
      const without = base({ width: 2.095 }).parts;
      const sink = parts.filter((p) => p.role === 'detail');
      expect(without.filter((p) => p.role === 'detail')).toHaveLength(0);
      expect(sink.filter((p) => p.shape === 'extrude')).toHaveLength(3);
      const tap = sink.at(-2)!;
      expect(tap.shape).toBe('extrude');
      const { min, max } = boundsOf([tap]);
      expect(max[1] - size.height).toBeGreaterThan(0.3);
      expect(max[1] - size.height).toBeLessThan(0.45);
      // It stands at the back and reaches forward over the bowl.
      expect(min[2]).toBeLessThan(-0.2);
      expect(max[2]).toBeGreaterThan(-0.08);
      expect(max[2]).toBeLessThan(0.05);
    });
  });

  it('a wall cabinet has handles of metal only where its style asks for them', () => {
    expect(finishesOf(draw('kitchen.wall-cabinet').parts)).toEqual(['plastic.matt']);
    const { parts } = draw('kitchen.wall-cabinet', { doors: 2, width: 1.35, frontStyle: 'handle' });
    const handles = parts.filter((p) => p.role === 'handle');
    expect(handles).toHaveLength(2);
    // A pair opens in the middle: the handles stand upright on both sides of it.
    expect(handles.map((h) => Math.sign(h.center[0]))).toEqual([-1, 1]);
    for (const h of handles) expect(h.size[1]).toBeCloseTo(0.12);
  });

  it('a tall cabinet’s glass door is a pane in a frame, the pane drawn last', () => {
    const { parts, size } = draw('kitchen.tall-cabinet');
    const pane = parts.at(-1)!;
    expect(pane.role).toBe('glass');
    expect(pane.material).toMatchObject({ finish: 'glass.clear', transparent: true });
    const frame = parts.filter((p) => p.role === 'leaf');
    expect(frame).toHaveLength(4);
    const { min, max } = boundsOf(frame);
    expect(max[0] - min[0]).toBeCloseTo(size.width - 0.003);
    expect(max[1] - min[1]).toBeCloseTo(size.height - 0.003);
    expect(pane.size[0]).toBeCloseTo(size.width - 0.003 - 0.04);
    const solid = draw('kitchen.tall-cabinet', { door: 'solid' }).parts;
    expect(solid.filter((p) => p.role === 'leaf')).toHaveLength(1);
    expect(solid.at(-1)!.role).toBe('handle');
  });

  it('a wall shelf of oak veneer is stained to its colour, a lacquered one keeps it', () => {
    const lacquer = draw('kitchen.wall-shelf').parts[0]!;
    expect(lacquer.material).toEqual({ finish: 'plastic.matt' });
    expect(lacquer.color).toBe('#3d2c20');
    const veneer = draw('kitchen.wall-shelf', { finish: 'wood.veneer' }).parts[0]!;
    expect(veneer.color).toBe(veneerTint('#3d2c20'));
    const pale = draw('kitchen.wall-shelf', { finish: 'wood.veneer', color: '#f0e6d2' }).parts[0]!;
    expect(pale.color).toBe('#ffffff');
    // The grain runs along the board.
    expect(veneer.rotationY).toBe(Math.PI / 2);
  });

  it('the shelf’s rail is a round bar on two stand-offs', () => {
    const { parts } = draw('kitchen.wall-shelf', { rail: 'hooks', width: 2.27 });
    const round = parts.filter((p) => p.shape === 'cylinder');
    expect(round).toHaveLength(3);
    const { min, max } = boundsOf([round[0]!]);
    expect(max[0] - min[0]).toBeCloseTo(2.07);
    expect(max[1] - min[1]).toBeCloseTo(0.012);
  });
});
