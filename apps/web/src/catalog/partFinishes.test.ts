import {
  catalog,
  defaultParams,
  effectiveParams,
  finishes,
  partFinishProblem,
  type CatalogType,
  type ParamValues,
} from '@my-home/shared';
import { Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { partItems } from '../builder/drawList';
import { previewContext } from '../catalog-page/preview';
import { hashParts } from '../catalog-page/thumbnails';
import { FinishMaterials, PLACEHOLDERS } from '../finishes/materials';
import { FinishTextures } from '../finishes/textures';
import { batches } from '../scene/batches';
import { partBatches } from './PartsMesh';
import { box } from './parts';
import { pieces } from './registry';

/**
 * Finishes on the parts of catalogue pieces (docs/design/realistic-render.md §5.7): a part names
 * a finish, its colour is the tint, and a type offers a choice of finishes as a parameter.
 */

const group = { kind: 'placement', id: 'p' } as const;
const drawn = (material: Parameters<typeof box>[4], color = '#806040') =>
  partItems([box([0, 0.5, 0], [1, 1, 1], color, 'body', material)], 'p', group)[0]!;

/** Every set of values a type can be drawn with that differs in a choice: one option at a time. */
function choices(type: CatalogType): ParamValues[] {
  const base = defaultParams(type);
  return [
    base,
    ...Object.entries(type.params).flatMap(([key, spec]) =>
      spec.type === 'choice' ? spec.options.map((o) => ({ ...base, [key]: o.value })) : [],
    ),
  ];
}

describe('a part with a finish', () => {
  it('draws with the finish, its colour as the tint', () => {
    expect(drawn({ finish: 'wood.veneer' })).toMatchObject({
      finish: 'wood.veneer',
      tint: '#806040',
    });
    expect(drawn(undefined)).toMatchObject({ finish: 'part', tint: '#806040' });
  });

  it('a finish that is not tintable keeps its own colour', () => {
    expect(finishes.get('ceramic.white')).toMatchObject({ tintable: false, tint: '#f4f4f0' });
    expect(drawn({ finish: 'ceramic.white' })).toMatchObject({
      finish: 'ceramic.white',
      tint: '#f4f4f0',
    });
  });

  it('takes its roughness and metalness from the finish, and keeps how see-through it is', () => {
    const item = drawn({
      finish: 'glass.clear',
      roughness: 0.9,
      metalness: 0.5,
      transparent: true,
      opacity: 0.3,
      castShadow: false,
    });
    expect(item.material).toEqual({ transparent: true, opacity: 0.3 });
    expect(item.castShadow).toBe(false);
    expect(drawn({ finish: 'metal.brushed', roughness: 0.9 }).material).toBeUndefined();
    // Without a finish the part's own settings stay.
    expect(drawn({ roughness: 0.9 }).material).toEqual({ roughness: 0.9 });
  });

  it('a finish the library does not have draws as a plain part', () => {
    expect(drawn({ finish: 'wood.mahogany', roughness: 0.4 })).toMatchObject({
      finish: 'part',
      tint: '#806040',
      material: { roughness: 0.4 },
    });
  });

  it('is a mesh per finish, with texture coordinates in metres where the finish has a texture', () => {
    const meshes = partBatches([
      box([0, 0.5, 0], [2, 1, 1], '#806040', 'body', { finish: 'wood.veneer' }),
      box([0, 1.5, 0], [2, 1, 1], '#a08060', 'body', { finish: 'wood.veneer' }),
      box([0, 2.5, 0], [0.1, 1, 0.1], '#b9bdc1', 'handle', { finish: 'metal.brushed' }),
      box([0, 3.5, 0], [1, 1, 1], '#ffffff', 'detail'),
    ]);
    expect(meshes.map((m) => [m.finish, m.items])).toEqual([
      ['wood.veneer', 2],
      ['metal.brushed', 1],
      ['part', 1],
    ]);
    const [veneer, metal, plain] = meshes;
    expect(metal!.geometry.getAttribute('uv')).toBeUndefined();
    expect(plain!.geometry.getAttribute('uv')).toBeUndefined();
    // A box projection in the part's own frame: the 2 m wide front runs from -1 to 1.
    const uv = veneer!.geometry.getAttribute('uv');
    const us = [...Array(uv.count).keys()].map((i) => uv.getX(i));
    expect(Math.min(...us)).toBeCloseTo(-1);
    expect(Math.max(...us)).toBeCloseTo(1);
  });

  it('changes the thumbnail’s key', () => {
    const plain = [box([0, 0, 0], [1, 1, 1], '#806040', 'body')];
    const veneer = [box([0, 0, 0], [1, 1, 1], '#806040', 'body', { finish: 'wood.veneer' })];
    expect(hashParts(veneer)).not.toBe(hashParts(plain));
  });
});

describe('the material of a part’s finish', () => {
  const set = () => {
    const waiting: ((t: Texture) => void)[] = [];
    const textures = new FinishTextures(
      'phone',
      () => new Promise((resolve) => waiting.push(resolve)),
      (path) => `/assets/${path}`,
      1000,
    );
    return { materials: new FinishMaterials(textures), textures, waiting };
  };

  it('a piece that glows gets a copy with the glow, which gets the textures like the others', async () => {
    const { materials, textures, waiting } = set();
    const plain = materials.material('wood.veneer');
    const glowing = materials.material('wood.veneer', undefined, {
      color: '#3d8bff',
      intensity: 0.4,
    });
    expect(glowing).not.toBe(plain);
    expect(materials.material('wood.veneer', undefined, { color: '#3d8bff', intensity: 0.4 })).toBe(
      glowing,
    );
    expect(glowing.emissive.getHexString()).toBe('3d8bff');
    expect(glowing.emissiveIntensity).toBe(0.4);
    expect(plain.emissive.getHexString()).toBe('000000');
    expect(glowing.map).toBe(PLACEHOLDERS.color);
    // The same slots as the plain one: the same shader program.
    expect(Object.keys(glowing).filter((k) => k.endsWith('Map') && glowing[k as 'map'])).toEqual(
      Object.keys(plain).filter((k) => k.endsWith('Map') && plain[k as 'map']),
    );
    textures.request('wood.veneer');
    const version = glowing.version;
    for (const arrive of waiting) arrive(new Texture());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(glowing.map).not.toBe(PLACEHOLDERS.color);
    expect(glowing.map).toBe(plain.map);
    expect(glowing.version).toBe(version);
  });

  it('has the finish’s roughness and metalness', () => {
    const { materials } = set();
    expect(materials.material('metal.brushed')).toMatchObject({ roughness: 0.4, metalness: 1 });
  });
});

describe('the finishes the catalogue’s pieces name', () => {
  it('every part of every type names only finishes of the library that a part may have', () => {
    let named = 0;
    for (const type of catalog.types) {
      for (const values of choices(type)) {
        for (const part of pieces.get(type.id)!.parts(values, previewContext(type, values))) {
          const finish = part.material?.finish;
          if (finish === undefined) continue;
          named += 1;
          expect(partFinishProblem(finish), `${type.id}: ${finish}`).toBeUndefined();
        }
      }
    }
    expect(named).toBeGreaterThan(0);
  });

  it('says why a finish may not be on a part', () => {
    expect(partFinishProblem('wood.veneer')).toBeUndefined();
    expect(partFinishProblem('wood.mahogany')).toMatch(/not a finish of the library/);
    expect(partFinishProblem('wood.oak-laminate')).toMatch(/not for parts/);
    expect(partFinishProblem('cut.dark')).toMatch(/not for parts/);
  });

  it('the wall shelf’s board has the finish its use chose, tinted with its colour', () => {
    const type = catalog.get('kitchen.wall-shelf')!;
    const board = (overrides: Record<string, unknown>) => {
      const { values } = effectiveParams(type, overrides);
      const parts = pieces.get(type.id)!.parts(values, previewContext(type, values));
      return batches(partItems(parts, 'p', group)).map((b) => b.finish);
    };
    expect(board({})).toEqual(['plastic.matt']);
    expect(board({ finish: 'wood.veneer', rail: 'hooks' })).toEqual(['wood.veneer', 'part']);
    const { values } = effectiveParams(type, { finish: 'wood.veneer', color: '#c9a36b' });
    const [part] = pieces.get(type.id)!.parts(values, previewContext(type, values));
    expect(part).toMatchObject({ color: '#c9a36b', material: { finish: 'wood.veneer' } });
  });
});
