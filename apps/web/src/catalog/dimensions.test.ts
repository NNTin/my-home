import { catalog, defaultParams, type CatalogType, type ParamValues } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import { previewContext } from '../catalog-page/preview';
import { pieces } from './registry';

/** The values with every basic count at its maximum: the most lines a type draws. */
function mostLines(type: CatalogType): ParamValues {
  const values = defaultParams(type);
  for (const [key, spec] of Object.entries(type.params)) {
    if (spec.type === 'count' && spec.tier === 'basic') values[key] = spec.max;
  }
  return values;
}

const linesOf = (type: CatalogType, values = defaultParams(type)) =>
  pieces.get(type.id)!.dimensions(values, previewContext(type, values));

describe('dimensions of every piece module', () => {
  it.each(catalog.types.map((t) => [t.id, t] as const))(
    '%s: named lines with positive values, labelled in cm with one decimal',
    (_id, type) => {
      for (const values of [defaultParams(type), mostLines(type)]) {
        const lines = linesOf(type, values);
        expect(lines.length).toBeGreaterThan(0);
        // The 3D overlay draws at most 8 labels (drei <Html> is costly on phones).
        expect(lines.length).toBeLessThanOrEqual(8);
        for (const line of lines) {
          expect(line.value).toBeGreaterThan(0);
          expect(line.name).toBeTruthy();
          expect(line.label).toMatch(/^\d+\.\d cm$/);
          expect(line.label).toBe(`${(line.value * 100).toFixed(1)} cm`);
        }
        expect(new Set(lines.map((l) => l.name)).size).toBe(lines.length);
      }
    },
  );

  const names = (id: string, values?: ParamValues) => {
    const type = catalog.get(id)!;
    return linesOf(type, values && { ...defaultParams(type), ...values }).map(
      (l) => `${l.name} ${l.label}`,
    );
  };

  it('windows: hole, sill, frame and sash widths', () => {
    expect(names('window.casement')).toEqual([
      'Width 120.0 cm',
      'Height 120.0 cm',
      'Sill height 90.0 cm',
      'Frame width 6.5 cm',
      'Sash width 107.0 cm',
    ]);
    expect(names('window.tilt-turn', { sashes: 3 })).toHaveLength(7);
  });

  it('doors: hole and frame, a French door its leaves; no sill line at floor level', () => {
    expect(names('door.interior')).toEqual([
      'Width 85.0 cm',
      'Height 200.0 cm',
      'Frame width 6.0 cm',
    ]);
    expect(names('door.french', { leaves: 2 }).slice(3)).toEqual([
      'Leaf 1 width 41.0 cm',
      'Leaf 2 width 41.0 cm',
    ]);
  });

  it.each([
    ['window.casement', 'sashes', 3],
    ['window.casement', 'sashes', 4],
    ['window.tilt-turn', 'sashes', 3],
    ['door.french', 'leaves', 2],
    ['door.french', 'leaves', 3],
  ])('%s: each %s line (%i) spans a gap between the drawn jambs and mullions', (id, key, n) => {
    const type = catalog.get(id)!;
    const values = { ...defaultParams(type), [key]: n };
    // Wide enough for every count; a 7 cm frame member.
    const ctx = { width: 1.4, height: 1.4, wallDepth: 0.36 };
    const module = pieces.get(id)!;
    const members = module
      .parts({ ...values, frameWidth: 0.07 }, ctx)
      .filter((p) => p.role === 'frame' && p.size[1] > ctx.height / 2)
      .map((p) => [p.center[0] - p.size[0] / 2, p.center[0] + p.size[0] / 2] as const)
      .sort((a, b) => a[0] - b[0]);
    expect(members).toHaveLength(n + 1);
    const gaps = members.slice(1).map((m, i) => [members[i]![1], m[0]]);
    const lines = module
      .dimensions({ ...values, frameWidth: 0.07 }, ctx)
      .filter((l) => / width$/.test(l.name ?? '') && !/^(Width|Frame width)$/.test(l.name!));
    expect(lines).toHaveLength(n);
    lines.forEach((line, i) => {
      expect(line.from[0]).toBeCloseTo(gaps[i]![0]!, 9);
      expect(line.to[0]).toBeCloseTo(gaps[i]![1]!, 9);
      expect(line.value).toBeCloseTo(gaps[i]![1]! - gaps[i]![0]!, 9);
    });
    if (n >= 3) expect(lines[0]!.value).toBeGreaterThan(lines[1]!.value);
  });

  it('gate: width and height', () => {
    expect(names('gate.swing')).toEqual(['Width 100.0 cm', 'Height 120.0 cm']);
  });

  it('furniture: width, depth or length, height; the table its diameter', () => {
    expect(names('furniture.bed', { width: 1.8 })).toEqual([
      'Width 180.0 cm',
      'Length 200.0 cm',
      'Height 50.0 cm',
    ]);
    expect(names('furniture.desk')[1]).toBe('Depth 70.0 cm');
    expect(names('furniture.table')).toEqual(['Diameter 110.0 cm', 'Height 75.0 cm']);
  });
});
