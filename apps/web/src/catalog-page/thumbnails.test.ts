import { Blob as NodeBlob } from 'node:buffer';
import { catalog, defaultParams } from '@my-home/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { box } from '../catalog/parts';
import { partBatches } from '../catalog/PartsMesh';
import { previewParts, thumbnailParts } from './preview';
import {
  cacheStorageStore,
  createThumbnailer,
  hashParts,
  memoryStore,
  thumbnailKey,
} from './thumbnails';

vi.mock('./renderThumbnail', () => ({ renderThumbnail: vi.fn(), THUMBNAIL_SIZE: 256 }));

const bed = catalog.get('furniture.bed')!;

describe('thumbnail cache key', () => {
  it('is thumb:<typeId>:<hash of the parts>', () => {
    const parts = previewParts(bed);
    expect(thumbnailKey(bed.id, parts)).toMatch(/^thumb:furniture\.bed:[0-9a-f]{8}$/);
    expect(thumbnailKey(bed.id, previewParts(bed))).toBe(thumbnailKey(bed.id, parts));
  });

  it('changes when the parts change', () => {
    const parts = previewParts(bed);
    const wider = previewParts(bed, { ...defaultParams(bed), width: 1.8 });
    expect(hashParts(wider)).not.toBe(hashParts(parts));
    const recoloured = parts.map((p, i) => (i === 0 ? { ...p, color: '#000000' } : p));
    expect(hashParts(recoloured)).not.toBe(hashParts(parts));
    // A tilted part changes the hash, and so does its tilt.
    const tilted = parts.map((p, k) => (k === 0 ? { ...p, rotationX: 0.2 } : p));
    expect(hashParts(tilted)).not.toBe(hashParts(parts));
    expect(hashParts(tilted.map((p, k) => (k === 0 ? { ...p, rotationX: 0.3 } : p)))).not.toBe(
      hashParts(tilted),
    );
  });

  it('every type has parts to draw', () => {
    for (const type of catalog.types) expect(previewParts(type).length, type.id).toBeGreaterThan(0);
  });
});

describe('createThumbnailer', () => {
  const parts = [box([0, 0.5, 0], [1, 1, 1], '#ffffff', 'body')];
  const other = [box([0, 0.5, 0], [2, 1, 1], '#ffffff', 'body')];

  it('renders one at a time, and never the same design twice', async () => {
    let running = 0;
    let most = 0;
    const render = vi.fn(async () => {
      most = Math.max(most, ++running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return new Blob(['x'], { type: 'image/png' });
    });
    const store = memoryStore();
    const put = vi.spyOn(store, 'put');
    let n = 0;
    const thumbs = createThumbnailer({ store, render, toUrl: () => `blob:${++n}` });
    const urls = await Promise.all([
      thumbs.get('a.x', parts),
      thumbs.get('b.x', other),
      thumbs.get('a.x', parts),
    ]);
    expect(most).toBe(1);
    expect(render).toHaveBeenCalledTimes(2);
    expect(urls[0]).toBe(urls[2]);
    expect(put.mock.calls.map(([key]) => key)).toEqual([
      thumbnailKey('a.x', parts),
      thumbnailKey('b.x', other),
    ]);

    // A later visit (a new page) finds them in the store.
    const again = createThumbnailer({ store, render, toUrl: () => 'blob:cached' });
    expect(await again.get('a.x', parts)).toBe('blob:cached');
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('carries on after a failed render', async () => {
    const render = vi
      .fn()
      .mockRejectedValueOnce(new Error('no WebGL'))
      .mockResolvedValue(new Blob(['x']));
    const thumbs = createThumbnailer({ store: memoryStore(), render, toUrl: () => 'blob:ok' });
    await expect(thumbs.get('a.x', parts)).rejects.toThrow('no WebGL');
    await expect(thumbs.get('b.x', other)).resolves.toBe('blob:ok');
  });
});

describe('cacheStorageStore', () => {
  /** Enough of the Cache Storage API: one cache, keyed by URL. */
  function stubCaches() {
    const entries = new Map<string, Response>();
    const cache = {
      match: (url: string) => Promise.resolve(entries.get(url)?.clone()),
      put: (url: string, response: Response) => Promise.resolve(void entries.set(url, response)),
      keys: () => Promise.resolve([...entries.keys()].map((url) => new Request(url))),
      delete: (request: Request) => Promise.resolve(entries.delete(request.url)),
    };
    vi.stubGlobal('caches', { open: () => Promise.resolve(cache) });
    return entries;
  }
  const names = (entries: Map<string, Response>) =>
    [...entries.keys()].map((url) => decodeURIComponent(new URL(url).pathname));
  afterEach(() => vi.unstubAllGlobals());

  it('keeps one thumbnail per type, and prunes the types no longer in the catalogue', async () => {
    const entries = stubCaches();
    const store = cacheStorageStore();
    // jsdom's Blob is not one Node's Response takes.
    const blob = new NodeBlob(['png'], { type: 'image/png' }) as unknown as Blob;
    await store.put('thumb:furniture.bed:00000001', blob);
    await store.put('thumb:furniture.bed:00000002', blob);
    await store.put('thumb:furniture.throne:00000003', blob);
    await store.put('thumb:window.casement:00000004', blob);
    entries.set(new URL('/__thumbnails/stray', window.location.origin).href, new Response('x'));
    expect(names(entries)).toHaveLength(4);
    await store.prune!(new Set(catalog.types.map((t) => t.id)));
    expect(names(entries)).toEqual([
      '/__thumbnails/thumb:furniture.bed:00000002',
      '/__thumbnails/thumb:window.casement:00000004',
    ]);
    expect((await store.get('thumb:furniture.bed:00000002'))?.size).toBe(3);
  });
});

describe('thumbnail parts', () => {
  it('are the preview, a ceiling piece turned over to show its room side to the camera above', () => {
    expect(thumbnailParts(bed)).toEqual(previewParts(bed));
    const light = catalog.get('fixture.downlight')!;
    const [housing, trim, lens] = previewParts(light);
    const [housingUp, trimUp, lensUp] = thumbnailParts(light);
    // In the house the housing is above the ceiling (y > 0) and the lens below it.
    expect(housing!.center[1]).toBeGreaterThan(0);
    expect(lens!.center[1]).toBeLessThan(0);
    expect(housingUp!.center[1]).toBeCloseTo(-housing!.center[1]);
    // The lens sits back in the trim ring, on the camera's side of the ceiling.
    expect(lensUp!.center[1]).toBeGreaterThan(0);
    expect(lensUp!.center[1]).toBeLessThan(trimUp!.center[1] + trimUp!.size[1] / 2);
    expect(lensUp!.size).toEqual(lens!.size);
    expect(trimUp!.center[1]).toBeCloseTo(-trim!.center[1]);
    // Each part is turned over with the piece: the ring's bevel faces the camera.
    expect(trimUp!.rotationX).toBe(Math.PI);
    const drawn = partBatches([trimUp!])[0]!.geometry;
    drawn.computeBoundingBox();
    expect(drawn.boundingBox!.min.y).toBeCloseTo(0);
    expect(drawn.boundingBox!.max.y).toBeCloseTo(trim!.size[1]);
  });
});
