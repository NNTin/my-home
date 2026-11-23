import { deviceTextureFiles, finishes, type DeviceClass } from '@my-home/shared';
import { NoColorSpace, RepeatWrapping, SRGBColorSpace, Texture } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { finishMaterials, FinishMaterials, PLACEHOLDERS } from './materials';
import { FinishTextures, type TextureEvent } from './textures';
import { textureUrl } from './urls';

// The texture loader and the materials of finishes (docs/design/realistic-render.md §4.4, §4.5,
// §5.3). No file is fetched and nothing is drawn: `load` is a fake.

const textured = finishes.finishes.filter((f) => f.texture);

/** A loader whose files arrive or fail when the test says so. */
function fake(device: DeviceClass) {
  const requests: string[] = [];
  const waiting = new Map<string, { resolve(t: Texture): void; reject(e: Error): void }>();
  const textures = new FinishTextures(
    device,
    (url) =>
      new Promise((resolve, reject) => {
        requests.push(url);
        waiting.set(url, { resolve, reject });
      }),
    (path) => `/assets/${path}`,
    1000,
  );
  const events: TextureEvent[] = [];
  textures.subscribe((e) => events.push(e));
  return {
    textures,
    requests,
    events,
    arrive: async (path: string) => {
      const texture = new Texture();
      waiting.get(`/assets/${path}`)!.resolve(texture);
      await Promise.resolve();
      await Promise.resolve();
      return texture;
    },
    fail: async (path: string) => {
      waiting.get(`/assets/${path}`)!.reject(new Error('404'));
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

afterEach(() => vi.useRealTimers());

describe('the texture loader', () => {
  it('a phone requests the 512 px colour and normal maps of each set, and never a 1024 px file', () => {
    const { textures, requests } = fake('phone');
    for (const finish of finishes.finishes) textures.request(finish.id);
    expect(requests).toHaveLength(23);
    expect(requests.every((url) => url.endsWith('-512.webp'))).toBe(true);
    expect(requests.some((url) => url.includes('1024') || url.includes('roughness'))).toBe(false);
    expect(new Set(requests).size).toBe(requests.length);
  });

  it('a desktop requests the 1024 px maps with the roughness maps, and never a 512 px file', () => {
    const { textures, requests } = fake('desktop');
    for (const finish of finishes.finishes) textures.request(finish.id);
    expect(requests).toHaveLength(30);
    expect(requests.every((url) => url.endsWith('-1024.webp'))).toBe(true);
    expect(requests.some((url) => url.includes('512'))).toBe(false);
    expect(requests.filter((url) => url.includes('roughness'))).toHaveLength(7);
  });

  it.each(['phone', 'desktop'] as const)(
    'a %s requests exactly one size of every set',
    (device) => {
      const { textures, requests } = fake(device);
      for (const finish of textured) textures.request(finish.id);
      for (const finish of textured) {
        const own = requests.filter((url) => url.startsWith(`/assets/${finish.texture!.id}/`));
        expect(own, finish.id).toEqual(
          deviceTextureFiles(finish, device).map((f) => `/assets/${f.path}`),
        );
        expect(new Set(own.map((url) => /-(\d+)\.webp$/.exec(url)![1])).size, finish.id).toBe(1);
      }
    },
  );

  it('asks once however often a finish is drawn, and only when it is drawn', () => {
    const { textures, requests } = fake('phone');
    expect(requests).toEqual([]);
    textures.request('grass.lawn');
    textures.request('grass.lawn');
    expect(requests).toEqual([
      '/assets/grass-lawn/color-512.webp',
      '/assets/grass-lawn/normal-512.webp',
    ]);
  });

  it('asks for nothing for a plain finish, a part’s finish or an unknown one', () => {
    const { textures, requests } = fake('desktop');
    for (const id of ['paint.plain', 'floor.neutral', 'shell.neutral', 'part', 'wood.gone']) {
      textures.request(id);
    }
    expect(requests).toEqual([]);
    expect(textures.pending).toBe(0);
  });

  it('sets a file up to repeat every `tileSize` metres, in its colour space', async () => {
    const { textures, arrive, events } = fake('desktop');
    textures.request('wood.oak-laminate');
    expect(textures.pending).toBe(3);
    const color = await arrive('wood-oak-laminate/color-1024.webp');
    const normal = await arrive('wood-oak-laminate/normal-1024.webp');
    expect(color.colorSpace).toBe(SRGBColorSpace);
    expect(normal.colorSpace).toBe(NoColorSpace);
    for (const texture of [color, normal]) {
      expect(texture.wrapS).toBe(RepeatWrapping);
      expect(texture.wrapT).toBe(RepeatWrapping);
      expect(texture.repeat.x).toBeCloseTo(1 / 1.7, 12);
      expect(texture.repeat.y).toBeCloseTo(1 / 1.7, 12);
    }
    expect(textures.maps('wood.oak-laminate')).toEqual({ color, normal });
    expect(events.map((e) => e.map)).toEqual(['color', 'normal']);
    expect(textures.counts()).toEqual({ loaded: 2, failed: 0, pending: 1 });
  });

  it('a file that fails is reported without a texture, and the others still arrive', async () => {
    const { textures, arrive, fail, events } = fake('phone');
    textures.request('grass.lawn');
    await fail('grass-lawn/color-512.webp');
    const normal = await arrive('grass-lawn/normal-512.webp');
    expect(events).toEqual([
      { finish: 'grass.lawn', map: 'color' },
      { finish: 'grass.lawn', map: 'normal', texture: normal },
    ]);
    expect(textures.maps('grass.lawn')).toEqual({ normal });
    expect(textures.counts()).toEqual({ loaded: 1, failed: 1, pending: 0 });
    // It is not asked for again in this visit.
    textures.request('grass.lawn');
    expect(textures.pending).toBe(0);
  });

  it('a file that never answers counts as failed after the time limit', async () => {
    vi.useFakeTimers();
    const { textures, events } = fake('phone');
    textures.request('soil.plain');
    await vi.advanceTimersByTimeAsync(1001);
    expect(events).toEqual([
      { finish: 'soil.plain', map: 'color' },
      { finish: 'soil.plain', map: 'normal' },
    ]);
    expect(textures.pending).toBe(0);
  });

  it('knows a hashed URL for every file of the library', () => {
    for (const finish of textured) {
      for (const device of ['phone', 'desktop'] as const) {
        for (const file of deviceTextureFiles(finish, device)) {
          expect(textureUrl(file.path), file.path).toMatch(/\.webp$/);
        }
      }
    }
    expect(textureUrl('grass-lawn/color-2048.webp')).toBeUndefined();
  });

  it('a web test that would fetch a texture fails instead of loading it', async () => {
    const real = new FinishTextures('phone');
    const events: TextureEvent[] = [];
    real.subscribe((e) => events.push(e));
    const fetched = vi.spyOn(globalThis, 'fetch');
    real.request('grass.lawn');
    await vi.waitFor(() => expect(real.pending).toBe(0));
    expect(events.map((e) => e.texture)).toEqual([undefined, undefined]);
    expect(fetched).not.toHaveBeenCalled();
    fetched.mockRestore();
  });
});

describe('the materials of finishes', () => {
  const make = (device: DeviceClass) => {
    const loader = fake(device);
    return { ...loader, materials: new FinishMaterials(loader.textures) };
  };

  it('a textured finish holds a 1 x 1 placeholder in every map slot until its files arrive', () => {
    const { materials } = make('desktop');
    const material = materials.material('wood.oak-laminate');
    expect(material.map).toBe(PLACEHOLDERS.color);
    expect(material.normalMap).toBe(PLACEHOLDERS.normal);
    expect(material.roughnessMap).toBe(PLACEHOLDERS.roughness);
    for (const placeholder of Object.values(PLACEHOLDERS)) {
      const image = placeholder.image as { width: number; height: number };
      expect([image.width, image.height]).toEqual([1, 1]);
    }
    expect(material.vertexColors).toBe(true);
  });

  it('an arriving file swaps the texture and nothing a shader program depends on', async () => {
    const { materials, textures, arrive } = make('desktop');
    const single = materials.material('wood.oak-laminate');
    const double = materials.material('wood.oak-laminate', { doubleSided: true });
    expect(double).not.toBe(single);
    textures.request('wood.oak-laminate');
    const versions = [single.version, double.version];
    const color = await arrive('wood-oak-laminate/color-1024.webp');
    const roughness = await arrive('wood-oak-laminate/roughness-1024.webp');
    for (const material of [single, double]) {
      expect(material.map).toBe(color);
      expect(material.roughnessMap).toBe(roughness);
      // Not arrived yet: still its placeholder.
      expect(material.normalMap).toBe(PLACEHOLDERS.normal);
    }
    // A material's version is what makes the renderer look at its program again.
    expect([single.version, double.version]).toEqual(versions);
  });

  it('a failed file leaves the finish on its tint: the placeholder stays', async () => {
    const { materials, textures, fail } = make('phone');
    const material = materials.material('grass.lawn');
    textures.request('grass.lawn');
    await fail('grass-lawn/color-512.webp');
    await fail('grass-lawn/normal-512.webp');
    expect(material.map).toBe(PLACEHOLDERS.color);
    expect(material.normalMap).toBe(PLACEHOLDERS.normal);
  });

  it('every textured finish of a device has the same slots, whatever maps its set has', () => {
    for (const device of ['phone', 'desktop'] as const) {
      const { materials } = make(device);
      for (const finish of textured) {
        const material = materials.material(finish.id);
        expect(material.map, finish.id).not.toBeNull();
        expect(material.normalMap, finish.id).not.toBeNull();
        expect(material.roughnessMap !== null, `${finish.id} on a ${device}`).toBe(
          device === 'desktop',
        );
      }
    }
  });

  it('a relief-only finish keeps the white placeholder as its colour', async () => {
    const { materials, textures, arrive } = make('phone');
    const material = materials.material('render.facade');
    textures.request('render.facade');
    const normal = await arrive('render-facade/normal-512.webp');
    expect(material.normalMap).toBe(normal);
    expect(material.map).toBe(PLACEHOLDERS.color);
  });

  it('a plain finish has no map, and the roughness and metalness of its definition', () => {
    const { materials } = make('desktop');
    const paint = materials.material('paint.plain');
    expect([paint.map, paint.normalMap, paint.roughnessMap]).toEqual([null, null, null]);
    expect(paint.roughness).toBe(0.9);
    expect(materials.material('metal.brushed').metalness).toBe(1);
  });

  it('is one material per finish and way of drawing, made with the files already here', async () => {
    const { materials, textures, arrive } = make('phone');
    textures.request('soil.plain');
    const color = await arrive('soil-plain/color-512.webp');
    const material = materials.material('soil.plain');
    expect(material.map).toBe(color);
    expect(materials.material('soil.plain')).toBe(material);
    const glass = materials.material('paint.plain', { transparent: true, depthWrite: false });
    expect(glass.transparent).toBe(true);
    expect(glass.depthWrite).toBe(false);
    expect(glass).not.toBe(materials.material('paint.plain'));
  });

  it('is one set per device class for the visit', () => {
    expect(finishMaterials('phone')).toBe(finishMaterials('phone'));
    expect(finishMaterials('phone')).not.toBe(finishMaterials('desktop'));
    expect(finishMaterials('desktop').device).toBe('desktop');
  });
});
