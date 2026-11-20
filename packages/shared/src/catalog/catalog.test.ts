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
  isPlacedKind,
  LEGACY_FURNITURE_TYPE_IDS,
  openingFitIssues,
  parseCm,
  mountingsFor,
  defaultElevation,
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
  it('declares the first-wave types, then the kitchen, corridor, fixture and garden types', () => {
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
      'furniture.shoe-cabinet',
      'furniture.storage-shelf',
      'kitchen.base-cabinet',
      'kitchen.wall-cabinet',
      'kitchen.wall-shelf',
      'kitchen.tall-cabinet',
      'appliance.fridge-freezer',
      'appliance.microwave',
      'fixture.downlight',
      'fixture.radiator',
      'garden.pergola',
      'garden.table',
      'garden.chair',
      'garden.bench',
      'garden.planter',
      'garden.shrub',
      'garden.grass',
      'garden.rock-pile',
      'garden.stepping-stone',
      'garden.log',
      'garden.bird-house',
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
      const kind = ['window', 'door', 'gate'].includes(t.family)
        ? 'openings'
        : t.family === 'fixture'
          ? 'fixtures'
          : t.family === 'garden'
            ? 'outdoor'
            : 'furniture';
      expect(t.kind, t.id).toBe(kind);
      expect(t.placement === 'floor', t.id).toBe(isPlacedKind(t));
      expect(t.mounting !== undefined, t.id).toBe(isPlacedKind(t));
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
      'window.casement': [
        'frameColor',
        'sashes',
        'handleSide',
        'boardColor',
        'shutter',
        'shutterClosed',
        'shutterColor',
        'curtain',
        'curtainClosed',
        'curtainColor',
      ],
      'window.tilt-turn': [
        'frameColor',
        'sashes',
        'handleSide',
        'boardColor',
        'shutter',
        'shutterClosed',
        'shutterColor',
        'curtain',
        'curtainClosed',
        'curtainColor',
      ],
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
      'furniture.shoe-cabinet': ['color', 'width', 'height', 'depth', 'doors'],
      'furniture.storage-shelf': [
        'color',
        'binColor',
        'width',
        'height',
        'depth',
        'columns',
        'rows',
      ],
      'kitchen.base-cabinet': [
        'frontColor',
        'worktopColor',
        'width',
        'depth',
        'height',
        'unitWidth',
        'fronts',
        'sink',
        'sinkAt',
        'hob',
        'hobAt',
        'oven',
        'ovenAt',
      ],
      'kitchen.wall-cabinet': [
        'frontColor',
        'carcassColor',
        'width',
        'height',
        'depth',
        'doors',
        'frontStyle',
      ],
      'kitchen.wall-shelf': ['color', 'width', 'depth', 'height', 'rail'],
      'kitchen.tall-cabinet': [
        'carcassColor',
        'door',
        'glassColor',
        'frontColor',
        'width',
        'height',
        'depth',
      ],
      'appliance.fridge-freezer': ['color', 'width', 'height', 'depth'],
      'appliance.microwave': ['color', 'width', 'height', 'depth'],
      'fixture.downlight': ['trimColor', 'diameter', 'light'],
      'fixture.radiator': ['color', 'width', 'height', 'depth', 'valveSide'],
      'garden.pergola': [
        'woodColor',
        'roofColor',
        'width',
        'depth',
        'height',
        'frontHeight',
        'posts',
      ],
      'garden.table': ['frameColor', 'topColor', 'width', 'depth', 'height'],
      'garden.chair': ['color', 'width', 'depth', 'height'],
      'garden.bench': ['color', 'width', 'depth', 'height'],
      'garden.planter': ['color', 'plantColor', 'diameter', 'height', 'plantHeight', 'shape'],
      'garden.shrub': ['leafColor', 'flowers', 'flowerColor', 'diameter', 'height'],
      'garden.grass': ['color', 'diameter', 'height'],
      'garden.rock-pile': ['color', 'width', 'depth', 'height'],
      'garden.stepping-stone': ['color', 'diameter'],
      'garden.log': ['color', 'width', 'diameter'],
      'garden.bird-house': ['color', 'roofColor', 'height'],
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

  it('declares where each placed type is mounted, and what the editor can place today', () => {
    const mounted = Object.fromEntries(
      catalog.types
        .filter(isPlacedKind)
        .filter((t) => t.mounting !== 'floor' || t.elevation !== undefined)
        .map((t) => [t.id, [t.mounting, t.elevation]]),
    );
    expect(mounted).toEqual({
      'kitchen.wall-cabinet': ['wall', 1.33],
      'kitchen.wall-shelf': ['wall', 1.52],
      'appliance.microwave': ['floor', 0.9],
      'fixture.downlight': ['ceiling', undefined],
      'fixture.radiator': ['wall', 0.1],
    });
    expect(mountingsFor(type('furniture.shoe-cabinet'))).toEqual(['floor', 'wall']);
    expect(mountingsFor(type('kitchen.wall-cabinet'))).toEqual(['wall', 'floor']);
    expect(mountingsFor(type('fixture.downlight'))).toEqual(['ceiling']);
    expect(defaultElevation(type('appliance.microwave'), 'floor')).toBe(0.9);
    expect(defaultElevation(type('fixture.downlight'), 'ceiling')).toBe(0);
    expect(LEGACY_FURNITURE_TYPE_IDS['shoe-cabinet']).toBeUndefined();
  });

  it('rejects a mounting outside a room and an elevation on the ceiling', () => {
    const door = type('door.interior');
    const light = type('fixture.downlight');
    expect(() => createCatalog([{ ...door, mounting: 'floor' }])).toThrow(
      /only placed pieces have a mounting/,
    );
    expect(() => createCatalog([{ ...light, placement: 'wall' }])).toThrow(/are placed/);
    // Outdoor pieces are the garden family and stand on the ground.
    const pergola = type('garden.pergola');
    expect(() => createCatalog([{ ...pergola, family: 'furniture' }])).toThrow(/garden family/);
    expect(() => createCatalog([{ ...pergola, mounting: 'wall' }])).toThrow(/on the ground/);
    expect(() => createCatalog([{ ...light, elevation: 2 }])).toThrow(
      /ceiling piece has no elevation/,
    );
    expect(() => createCatalog([{ ...type('fixture.radiator'), elevation: -1 }])).toThrow(
      /must not be negative/,
    );
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
    const withParam = (spec: object) =>
      createCatalog([{ ...bed, params: { x: { tier: 'basic', label: 'X', ...spec } as never } }]);
    expect(() => withParam({ type: 'fraction', default: 1.5, step: 0.05 })).toThrow(/from 0 to 1/);
    expect(() => withParam({ type: 'fraction', default: 0, step: 0 })).toThrow(/step 0/);
    const options = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ];
    expect(() => withParam({ type: 'choice', default: 'c', options })).toThrow(/not an option/);
    expect(() =>
      withParam({ type: 'choice', default: 'a', options: [options[0], options[0]] }),
    ).toThrow(/duplicate option/);
    expect(() => withParam({ type: 'choice', default: 'a', options: [options[0]] })).toThrow(
      /at least two/,
    );
  });

  it('gives the wall windows a shutter and a curtain, both off by default', () => {
    for (const id of ['window.casement', 'window.tilt-turn']) {
      const defaults = defaultParams(type(id));
      expect(defaults).toMatchObject({
        shutter: 'none',
        shutterClosed: 0,
        curtain: 'none',
        curtainClosed: 0,
        handleSide: 'right',
      });
      expect(type(id).params.shutter).toMatchObject({
        type: 'choice',
        options: [
          { value: 'none', label: 'None' },
          { value: 'outside', label: 'Box outside' },
          { value: 'inside', label: 'Box inside' },
        ],
      });
      expect(type(id).params.curtainClosed).toEqual({
        type: 'fraction',
        tier: 'basic',
        label: 'Curtain closed',
        default: 0,
        step: 0.05,
      });
    }
    // Both wall window types share every parameter, so a git change of type keeps overrides valid.
    expect(type('window.casement').params).toEqual(type('window.tilt-turn').params);
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
    // Fractions from 0 to 1, choices among their options only.
    expect(issues({ shutterClosed: 1.2 })).toEqual(['shutterClosed']);
    expect(issues({ curtainClosed: -0.1 })).toEqual(['curtainClosed']);
    expect(issues({ shutter: 'half' })).toEqual(['shutter']);
    expect(issues({ curtain: 2 })).toEqual(['curtain']);
    expect(issues({ shutter: 'outside', shutterClosed: 0.4, curtain: 'both' })).toEqual([]);
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

  it('catches a corner of a concave room that pokes into the footprint', () => {
    // A square room with a thin wall spike from its south side up to (2, 2).
    const spiked = {
      outline: outline([
        [0, 0],
        [4, 0],
        [4, 4],
        [2.1, 4],
        [2, 2],
        [1.9, 4],
        [0, 4],
      ]),
    };
    // Every corner of the bed (x 1.2–2.8, z 1.5–3.5) is in the room; the spike's tip is in the bed.
    expect(furnitureFitIssues(bed, values, { x: 2, z: 2.5, rotationY: 0 }, spiked)).toHaveLength(1);
    expect(furnitureFitIssues(bed, values, { x: 1, z: 1.2, rotationY: 0 }, spiked)).toEqual([]);
    // Flush with the tip is fine.
    expect(furnitureFitIssues(bed, values, { x: 2, z: 1, rotationY: 0 }, spiked)).toEqual([]);
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
