import { catalog, defaultParams } from '@my-home/shared';
import { describe, expect, it, vi } from 'vitest';
import { box } from '../catalog/parts';
import { previewParts } from './preview';
import { createThumbnailer, hashParts, memoryStore, thumbnailKey } from './thumbnails';

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
