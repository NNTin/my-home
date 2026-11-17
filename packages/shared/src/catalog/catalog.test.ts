import { describe, expect, it } from 'vitest';
import type { Polygon } from '../home-model';
import {
  basicOverridesSchema,
  catalog,
  createCatalog,
  defaultParams,
  effectiveParams,
  formatCm,
  formatIssues,
  furnitureFitIssues,
  LEGACY_FURNITURE_TYPE_IDS,
  openingFitIssues,
  parseCm,
  type CatalogType,
} from '../index';

const type = (id: string): CatalogType => {
  const t = catalog.get(id);
  if (!t) throw new Error(`no type ${id}`);
  return t;
};

const outline = (points: [number, number][]): Polygon =>
  points.map(([x, z]) => ({ x: { value: x, source: 'mock' }, z: { value: z, source: 'mock' } }));

describe('catalog', () => {
  it('declares the 14 first-wave types', () => {
    expect(catalog.types.map((t) => t.id)).toEqual([
      'window.casement',
      'window.tilt-turn',
      'window.roof',
      'door.interior',
      'door.exterior',
      'door.french',
      'door.garage',
      'gate.swing',
      'furniture.bed',
      'furniture.sofa',
      'furniture.table',
      'furniture.chair',
      'furniture.wardrobe',
      'furniture.desk',
    ]);
    expect(catalog.get('furniture.bed')?.category).toBe('Bed room');
    expect(catalog.get('window.fixed')).toBeUndefined();
    expect(LEGACY_FURNITURE_TYPE_IDS).toMatchObject({
      bed: 'furniture.bed',
      table: 'furniture.table',
    });
  });

  it('keeps every id, kind and placement consistent', () => {
    for (const t of catalog.types) {
      expect(t.id.startsWith(`${t.family}.`), t.id).toBe(true);
      expect(t.kind, t.id).toBe(t.family === 'furniture' ? 'furniture' : 'openings');
      expect(t.placement === 'floor', t.id).toBe(t.kind === 'furniture');
      expect(t.openingTypes !== undefined, t.id).toBe(t.placement === 'wall');
    }
  });

  it('splits basic and design parameters as decided', () => {
    const basic = Object.fromEntries(
      catalog.types.map((t) => [
        t.id,
        Object.entries(t.params)
          .filter(([, s]) => s.tier === 'basic')
          .map(([k]) => k),
      ]),
    );
    expect(basic).toEqual({
      'window.casement': ['frameColor', 'sashes'],
      'window.tilt-turn': ['frameColor', 'sashes'],
      'window.roof': ['glassColor'],
      'door.interior': ['frameColor'],
      'door.exterior': ['frameColor'],
      'door.french': ['frameColor', 'leaves'],
      'door.garage': ['frameColor', 'panelColor'],
      'gate.swing': ['color', 'postColor'],
      'furniture.bed': ['color', 'width', 'length'],
      'furniture.sofa': ['color', 'width'],
      'furniture.table': ['color', 'diameter'],
      'furniture.chair': ['color'],
      'furniture.wardrobe': ['color', 'width', 'height'],
      'furniture.desk': ['color', 'width', 'depth'],
    });
    expect(type('furniture.bed').params.width).toEqual({
      type: 'length',
      tier: 'basic',
      label: 'Width',
      default: 1.6,
      min: 0.8,
      max: 2.2,
      step: 0.001,
    });
  });

  it('throws on duplicate ids, min above max and defaults outside their limits', () => {
    const bed = type('furniture.bed');
    expect(() => createCatalog([bed, bed])).toThrow(/"furniture.bed": duplicate id/);
    const withWidth = (width: object) =>
      createCatalog([
        { ...bed, params: { ...bed.params, width: { ...bed.params.width!, ...width } } },
      ]);
    expect(() => withWidth({ min: 3 })).toThrow(/min 3 is above max 2.2/);
    expect(() => withWidth({ default: 2.5 })).toThrow(/default 2.5 is outside 0.8 to 2.2/);
    expect(() => createCatalog([{ ...bed, id: 'Bed' }])).toThrow(/family.name/);
    expect(() =>
      createCatalog([
        {
          ...bed,
          params: { color: { type: 'color', tier: 'basic', label: 'C', default: '#ABC' } },
        },
      ]),
    ).toThrow(/#rrggbb/);
  });
});

describe('basic overrides', () => {
  it("accepts every type's defaults for its basic parameters", () => {
    for (const t of catalog.types) {
      const defaults = defaultParams(t);
      const basic = Object.fromEntries(
        Object.keys(t.params)
          .filter((k) => t.params[k]!.tier === 'basic')
          .map((k) => [k, defaults[k]!]),
      );
      expect(basicOverridesSchema(t).parse(basic), t.id).toEqual(basic);
      expect(basicOverridesSchema(t).parse({}), t.id).toEqual({});
    }
  });

  it('lower-cases colours', () => {
    expect(basicOverridesSchema(type('window.casement')).parse({ frameColor: '#383E42' })).toEqual({
      frameColor: '#383e42',
    });
  });

  it('rejects out-of-range, wrong-type, design and unknown keys with paths', () => {
    const schema = basicOverridesSchema(type('window.casement'));
    const issues = (input: unknown) => {
      const result = schema.safeParse(input);
      return result.success ? [] : formatIssues(result.error).map((i) => i.path);
    };
    expect(issues({ sashes: 5 })).toEqual(['sashes']);
    expect(issues({ sashes: 1.5 })).toEqual(['sashes']);
    expect(issues({ sashes: '2' })).toEqual(['sashes']);
    expect(issues({ frameColor: 'white' })).toEqual(['frameColor']);
    expect(issues({ glassOpacity: 0.5 })).toEqual(['']);
    expect(issues({ colour: '#ffffff' })).toEqual(['']);
    const bed = basicOverridesSchema(type('furniture.bed'));
    expect(bed.safeParse({ width: 0.79 }).success).toBe(false);
    expect(bed.safeParse({ width: 2.2, length: 1.9 }).success).toBe(true);
  });
});

describe('effectiveParams', () => {
  it('applies valid overrides over the defaults', () => {
    const { values, ignored } = effectiveParams(type('furniture.desk'), {
      width: 1.8,
      color: '#AABBCC',
    });
    expect(values).toEqual({ color: '#aabbcc', width: 1.8, depth: 0.7, height: 0.75 });
    expect(ignored).toEqual([]);
  });

  it('drops invalid, design and unknown keys into `ignored`', () => {
    const { values, ignored } = effectiveParams(type('furniture.desk'), {
      width: 9,
      height: 1,
      legs: 4,
      depth: 0.6,
    });
    expect(values).toEqual({ ...defaultParams(type('furniture.desk')), depth: 0.6 });
    expect(ignored).toEqual(['width', 'height', 'legs']);
  });

  it('treats missing or non-object overrides as none', () => {
    const defaults = defaultParams(type('gate.swing'));
    expect(effectiveParams(type('gate.swing'))).toEqual({ values: defaults, ignored: [] });
    expect(effectiveParams(type('gate.swing'), 'oops')).toEqual({ values: defaults, ignored: [] });
    expect(effectiveParams(type('gate.swing'), null).values).toEqual(defaults);
  });
});

describe('centimetres', () => {
  it('formats with one decimal', () => {
    expect(formatCm(0.925)).toBe('92.5 cm');
    expect(formatCm(2)).toBe('200.0 cm');
    expect(formatCm(0.0004)).toBe('0.0 cm');
  });

  it('parses a comma or a point, rounded to the millimetre', () => {
    expect(parseCm('92,5')).toBe(0.925);
    expect(parseCm('92.5')).toBe(0.925);
    expect(parseCm(' 160 cm ')).toBe(1.6);
    expect(parseCm('12.34')).toBe(0.123);
    for (const bad of ['', 'abc', '1,2,3', '9 m']) expect(parseCm(bad), bad).toBeUndefined();
  });

  it('round-trips', () => {
    for (const metres of [0.001, 0.06, 0.925, 1.6, 2.235]) {
      expect(parseCm(formatCm(metres))).toBe(metres);
    }
  });
});

describe('openingFitIssues', () => {
  const casement = type('window.casement');
  const fits = (sashes: number, width: number) =>
    openingFitIssues(casement, { ...defaultParams(casement), sashes }, { width, height: 1.2 });

  it.each([
    [0.6, [1, 2]],
    [1.0, [1, 2, 3, 4]],
    [2.3, [1, 2, 3, 4]],
  ])('fits the sashes that leave 25 cm each in a %s m hole', (width, ok) => {
    for (let sashes = 1; sashes <= 4; sashes++) {
      expect(fits(sashes, width).length === 0, `${sashes} sashes`).toBe(ok.includes(sashes));
    }
  });

  it('explains in centimetres', () => {
    expect(fits(3, 0.6)).toEqual(['3 sashes need at least 75.0 cm, the opening is 60.0 cm']);
    expect(fits(1, 0.2)).toEqual(['1 sash needs at least 25.0 cm, the opening is 20.0 cm']);
    const french = type('door.french');
    expect(openingFitIssues(french, { leaves: 3 }, { width: 1, height: 2.2 })).toEqual([
      '3 leaves need at least 120.0 cm, the opening is 100.0 cm',
    ]);
    expect(openingFitIssues(type('door.interior'), {}, { width: 0.1, height: 2 })).toEqual([]);
  });
});

describe('furnitureFitIssues', () => {
  const bed = type('furniture.bed');
  const values = defaultParams(bed); // 1.6 x 2.0
  const square = {
    outline: outline([
      [0, 0],
      [3, 0],
      [3, 3],
      [0, 3],
    ]),
  };
  // An L: 4 x 4 without its north-east quarter (x > 2, z < 2).
  const ell = {
    outline: outline([
      [0, 0],
      [2, 0],
      [2, 2],
      [4, 2],
      [4, 4],
      [0, 4],
    ]),
  };

  it('fits a bed in a rectangular room, flush with the walls', () => {
    expect(furnitureFitIssues(bed, values, { x: 1.5, z: 1.5, rotationY: 0 }, square)).toEqual([]);
    expect(furnitureFitIssues(bed, values, { x: 0.8, z: 1, rotationY: 0 }, square)).toEqual([]);
    expect(furnitureFitIssues(bed, values, { x: 1, z: 1, rotationY: 0 })).toEqual([]);
  });

  it('checks the rotated footprint', () => {
    // 2.0 m along x once turned a quarter: still fits 3 m, but not when pushed to the side.
    const turned = { rotationY: Math.PI / 2 };
    expect(furnitureFitIssues(bed, values, { x: 1.5, z: 1.5, ...turned }, square)).toEqual([]);
    expect(furnitureFitIssues(bed, values, { x: 0.5, z: 1.5, ...turned }, square)).toEqual([
      'The bed (160.0 cm × 200.0 cm) reaches outside the room',
    ]);
    // Turned 45°, the diagonal (2.56 m) needs more room than the 3 m square gives at its centre.
    expect(
      furnitureFitIssues(
        bed,
        { ...values, width: 2.2, length: 2.2 },
        { x: 1.5, z: 1.5, rotationY: Math.PI / 4 },
        square,
      ),
    ).toHaveLength(1);
  });

  it("catches a corner in an L-shaped room's missing quarter", () => {
    expect(furnitureFitIssues(bed, values, { x: 1, z: 2, rotationY: 0 }, ell)).toEqual([]);
    expect(furnitureFitIssues(bed, values, { x: 2.5, z: 2.9, rotationY: 0 }, ell)).toHaveLength(1);
    expect(
      furnitureFitIssues(bed, values, { x: 3, z: 2.5, rotationY: Math.PI / 2 }, ell),
    ).toHaveLength(1);
  });

  it('samples a round table as an ellipse', () => {
    const table = type('furniture.table');
    const corner = {
      outline: outline([
        [0, 0],
        [1.2, 0],
        [0, 1.2],
      ]),
    };
    // A 1.1 m disc at (0.56, 0.56) stays inside the box of the triangle but not the triangle.
    expect(
      furnitureFitIssues(table, defaultParams(table), { x: 0.6, z: 0.6, rotationY: 0 }, square),
    ).toEqual([]);
    expect(
      furnitureFitIssues(table, defaultParams(table), { x: 0.56, z: 0.56, rotationY: 0 }, corner),
    ).toHaveLength(1);
  });
});
