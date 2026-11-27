import { afterEach, describe, expect, it, vi } from 'vitest';

// The tracer needs WebGPU (D99); these tests are about the page's settings and sizes only.
vi.mock('./tracer', () => ({ BOUNCES: 8, SAMPLE_TARGET: 256, Trace: {}, loadDenoiser: vi.fn() }));

const { chunkSize, gateDenoiser, gateSettings } = await import('./gate');

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the measuring page', () => {
  it('denoises with the small weights unless the address asks for others', () => {
    expect(gateSettings('?render=measure').weights).toBe('small');
    expect(gateSettings('?render=measure&weights=default').weights).toBe('default');
    expect(gateSettings('?render=measure&weights=none').weights).toBe('none');
    expect(gateSettings('?render=measure&weights=large').weights).toBe('small');
  });

  it('names the denoiser it measured with, or why there was none', async () => {
    const source = {
      weights: 'default' as const,
      bytes: 1_841_160,
      seconds: 1.25,
      initUNetFromURL: () => undefined,
    };
    const loaded = await gateDenoiser('default', async () => source);
    expect(loaded.source).toBe(source);
    expect(loaded.text).toBe('default weights, 1841.2 kB, downloaded with its code in 1.3 s');
    const failed = await gateDenoiser('small', () => Promise.reject(new Error('HTTP 404')));
    expect(failed).toEqual({
      source: undefined,
      text: 'small weights not loaded (HTTP 404): raw stills',
    });
    const load = vi.fn();
    expect((await gateDenoiser('none', load)).source).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });
});

describe("a lazy chunk's size on the measuring page", () => {
  const timing = (name: string, encoded: number, decoded: number, contentEncoding = 'gzip') =>
    ({
      name: `https://home.example/assets/${name}`,
      entryType: 'resource',
      encodedBodySize: encoded,
      decodedBodySize: decoded,
      contentEncoding,
    }) as unknown as PerformanceEntry;

  it('adds up the files of the chunk asked for, as sent, unpacked and gzipped again', async () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      timing('render-path-AbC1.js', 300_000, 1_000_000),
      timing('render-path-AbC1.css', 1_000, 3_000),
      timing('render-denoise-Xy2.js', 40_000, 150_000),
      timing('index-Q.js', 450_000, 1_500_000),
    ]);
    const fetched = vi.fn(async () => new Response('a'.repeat(5_000)));
    vi.stubGlobal('fetch', fetched);
    const size = await chunkSize('render-path');
    expect(size).toMatchObject({ served: 301_000, decoded: 1_003_000, encoding: 'gzip' });
    // Each file again, from the cache, gzipped by the browser: a run of one letter is small.
    expect(fetched).toHaveBeenCalledTimes(2);
    expect(fetched).toHaveBeenCalledWith('https://home.example/assets/render-path-AbC1.js', {
      cache: 'force-cache',
    });
    expect(size!.gzip).toBeGreaterThan(0);
    expect(size!.gzip).toBeLessThan(2 * 5_000);
    expect(await chunkSize('render-denoise')).toMatchObject({ served: 40_000, decoded: 150_000 });
  });

  it('says nothing when the browser does not, and no gzip number without the files again', async () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      timing('render-path-AbC1.js', 0, 0),
    ]);
    expect(await chunkSize('render-path')).toBeUndefined();
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      timing('render-path-AbC1.js', 300_000, 1_000_000, ''),
    ]);
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    expect(await chunkSize('render-path')).toEqual({
      served: 300_000,
      decoded: 1_000_000,
      encoding: undefined,
      gzip: undefined,
    });
  });
});
