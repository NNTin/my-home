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
  it('cuts a casement window with one sash: wall, frame, sash, glass, window board, outside sill', () => {
    const { shapes } = sectionFor('window.casement');
    // Preview hole 1.2 × 1.2 m, sill 0.9 m, wall 0.36 m, the outdoors at -z (the room faces the
    // camera). Frame 6.5 × 7 cm set back 12 cm from the facade; sash 6 × 7.8 cm; glass 2.4 cm.
    expect(roles(shapes)).toEqual([
      'wall',
      'wall',
      'frame',
      'frame',
      'sash',
      'sash',
      'glass',
      'board',
      'sill',
    ]);
    expect(shapes.map(rect)).toEqual([
      [-0.18, 0.18, 0.6, 0.9], // over the head
      [-0.18, 0.18, -1.5, -0.6], // under the hole, down to the floor
      [-0.06, 0.01, 0.535, 0.6], // frame head
      [-0.06, 0.01, -0.6, -0.535], // frame bottom member
      [-0.05, 0.028, 0.475, 0.535], // sash top member, 1.8 cm proud into the room
      [-0.05, 0.028, -0.535, -0.475], // sash bottom member
      [-0.023, 0.001, -0.475, 0.475], // glass
      [0.01, 0.21, -0.61, -0.58], // window board, 3 cm past the inner wall face
      [-0.23, -0.06, -0.615, -0.595], // outside sill, 5 cm past the facade
    ]);
  });

  it('cuts the mullion of a casement window with two sashes', () => {
    const { shapes } = sectionFor('window.casement', { sashes: 2 });
    expect(roles(shapes)).toEqual(['wall', 'wall', 'frame', 'frame', 'frame', 'board', 'sill']);
    expect(rect(shapes[4]!)).toEqual([-0.06, 0.01, -0.535, 0.535]);
  });

  it('cuts a roller shutter box outside and a curtain rod in the room', () => {
    const { shapes, labels } = sectionFor('window.tilt-turn', {
      shutter: 'outside',
      shutterClosed: 1,
      curtain: 'both',
    });
    const shutter = shapes.filter((s) => s.role === 'shutter').map(rect);
    // The box on the facade over the hole, and the closed slats in front of the window.
    expect(shutter[0]).toEqual([-0.36, -0.18, 0.6, 0.8]);
    expect(shutter[1]).toEqual([-0.212, -0.198, -0.6, 0.6]);
    expect(shapes.filter((s) => s.role === 'curtain').map(rect)).toEqual([
      [0.259, 0.281, 0.739, 0.761],
    ]);
    expect(labels.map((l) => l.name)).toContain('Shutter box height');
    expect(labels.find((l) => l.name === 'Shutter box depth')!.label).toBe('18.0 cm');
  });

  it('cuts a French door: no sill member and no wall under it, glass down to the floor', () => {
    const { shapes } = sectionFor('door.french');
    // The head, the leaf's top and bottom rails, and the pane between them.
    expect(roles(shapes)).toEqual(['wall', 'frame', 'sash', 'sash', 'glass']);
    expect(rect(shapes[4]!)).toEqual([-0.01, 0.01, -0.92, 0.95]);
    expect(rect(shapes[3]!)).toEqual([-0.02, 0.02, -1.1, -0.92]);
  });

  it('cuts a garage door: head and panel', () => {
    const { shapes } = sectionFor('door.garage');
    // The backing, then the four sections.
    expect(roles(shapes)).toEqual(['wall', 'frame', 'panel', 'panel', 'panel', 'panel', 'panel']);
    expect(rect(shapes[2]!)).toEqual([-0.02, 0, -1.05, 0.99]);
    expect(rect(shapes[3]!)).toEqual([-0.02, 0.02, -1.044, -0.546]);
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
      'Frame depth 7.0 cm',
      'Sash depth 7.8 cm',
      'Glass depth 2.4 cm',
      'Window board depth 20.0 cm',
      'Sill depth 17.0 cm',
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
