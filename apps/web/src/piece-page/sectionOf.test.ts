import { catalog, defaultParams, type ParamValues } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import { previewContext, previewParts } from '../catalog-page/preview';
import { box, cylinder } from '../catalog/parts';
import { cutParts, sectionLabels, sectionOf, wallStub } from './section';

const sectionFor = (id: string, overrides: ParamValues = {}) => {
  const type = catalog.get(id)!;
  const values = { ...defaultParams(type), ...overrides };
  const ctx = previewContext(type, values);
  const shapes = sectionOf(previewParts(type, values), ctx);
  return { shapes, ctx, labels: sectionLabels(shapes, ctx) };
};

const roles = (shapes: { role: string }[]) => shapes.map((s) => s.role);
const round = (n: number) => Math.round(n * 1e6) / 1e6;
const rect = (s: { z: number[]; y: number[] }) => [...s.z, ...s.y].map(round);

describe('sectionOf', () => {
  it('cuts a casement window with one sash: wall under and over, head, sill member, glass', () => {
    const { shapes } = sectionFor('window.casement');
    // Preview hole 1.2 × 1.2 m, sill 0.9 m, wall 0.36 m; frame 6 × 10 cm; glass 2 cm.
    expect(roles(shapes)).toEqual(['wall', 'wall', 'frame', 'frame', 'glass']);
    expect(shapes.map(rect)).toEqual([
      [-0.18, 0.18, 0.6, 0.9], // over the head
      [-0.18, 0.18, -1.5, -0.6], // under the sill, down to the floor
      [-0.05, 0.05, 0.54, 0.6], // head
      [-0.05, 0.05, -0.6, -0.54], // bottom member
      [-0.01, 0.01, -0.54, 0.54], // glass
    ]);
  });

  it('cuts the mullion of a casement window with two sashes', () => {
    const { shapes } = sectionFor('window.casement', { sashes: 2 });
    expect(roles(shapes)).toEqual(['wall', 'wall', 'frame', 'frame', 'frame', 'glass']);
    expect(rect(shapes[4]!)).toEqual([-0.05, 0.05, -0.54, 0.54]);
  });

  it('cuts a French door: no sill member and no wall under it, glass down to the floor', () => {
    const { shapes } = sectionFor('door.french');
    expect(roles(shapes)).toEqual(['wall', 'frame', 'glass']);
    expect(rect(shapes[2]!)).toEqual([-0.01, 0.01, -1.1, 1.04]);
  });

  it('cuts a garage door: head and panel', () => {
    const { shapes } = sectionFor('door.garage');
    expect(roles(shapes)).toEqual(['wall', 'frame', 'panel']);
    expect(rect(shapes[2]!)).toEqual([-0.02, 0.02, -1.05, 0.99]);
  });

  it('uses the piece’s own section instead of the cut when it has one', () => {
    const own = [{ role: 'sill' as const, color: '#ffffff', z: [0, 0.2], y: [0, 0.03] }] as never;
    const ctx = { width: 1, height: 1, wallDepth: 0.3 };
    expect(roles(sectionOf([], ctx, { own, stub: 'none' }))).toEqual(['sill']);
  });

  it('cuts turned boxes and cylinders, and skips parts the plane misses', () => {
    const turned = { ...box([0, 0.5, 0], [2, 1, 0.1], '#000000', 'panel'), rotationY: Math.PI / 4 };
    const [cut] = cutParts([turned]);
    expect(cut!.z.map(round)).toEqual([-0.070711, 0.070711]);
    expect(cutParts([cylinder([0, 0.5, 0.1], 1, 1, '#000000', 'body', 0.5)])[0]!.z).toEqual([
      -0.15, 0.35,
    ]);
    expect(cutParts([box([1, 0, 0], [1, 1, 1], '#000000', 'frame')])).toEqual([]);
    expect(cutParts([cylinder([0.5, 0, 0], 1, 1, '#000000', 'body')])).toEqual([]);
  });
});

describe('sectionLabels', () => {
  it('labels a window in cm with one decimal', () => {
    expect(sectionFor('window.casement').labels.map((l) => `${l.name} ${l.label}`)).toEqual([
      'Wall depth 36.0 cm',
      'Frame depth 10.0 cm',
      'Glass depth 2.0 cm',
      'Sill height 90.0 cm',
      'Opening height 120.0 cm',
    ]);
  });

  it('leaves out the sill height of a door and names its panel', () => {
    expect(sectionFor('door.garage').labels.map((l) => l.name)).toEqual([
      'Wall depth',
      'Frame depth',
      'Panel depth',
      'Opening height',
    ]);
  });

  it('labels every opening type, each in cm with one decimal', () => {
    for (const type of catalog.types.filter((t) => t.kind === 'openings')) {
      const ctx = previewContext(type, defaultParams(type));
      const stub = type.placement === 'wall' ? 'wall' : 'none';
      const shapes = sectionOf(previewParts(type), ctx, { stub });
      expect(shapes.length, type.id).toBeGreaterThan(0);
      for (const l of sectionLabels(shapes, ctx, { stub })) expect(l.label).toMatch(/^\d+\.\d cm$/);
    }
  });
});

describe('wallStub', () => {
  it('surrounds the hole down to the floor', () => {
    const parts = wallStub({ width: 1, height: 1, wallDepth: 0.3, sill: 0.5 });
    expect(parts).toHaveLength(4);
    expect(parts.every((p) => p.size[2] === 0.3)).toBe(true);
    expect(round(Math.min(...parts.map((p) => p.center[1] - p.size[1] / 2)))).toBe(-1);
    expect(wallStub({ width: 1, height: 2, wallDepth: 0.3, sill: 0 })).toHaveLength(3);
  });
});
