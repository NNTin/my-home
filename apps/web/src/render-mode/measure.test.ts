import { describe, expect, it } from 'vitest';
import budget from '../../bundle-budget.json';
import {
  checkpoints,
  chunkBudget,
  cleanAt,
  denoiseSeconds,
  gateReport,
  imageDifference,
  passes,
  type GateContext,
  type ViewMeasurement,
} from './measure';

const view = (over: Partial<ViewMeasurement> = {}): ViewMeasurement => ({
  view: 'cutaway',
  meshes: 200,
  triangles: 40000,
  lamps: 9,
  buildSeconds: 0.4,
  firstSampleSeconds: 2.1,
  // Raw: clean at 64 samples (13 s). Denoised: clean at 16 (5 s), each pass 1 s.
  checkpoints: [
    { samples: 16, seconds: 4, denoised: { seconds: 5 } },
    {
      samples: 32,
      seconds: 8,
      raw: { mean: 2.5, changed: 0.2 },
      denoised: { seconds: 9, change: { mean: 0.4, changed: 0.008 } },
    },
    {
      samples: 64,
      seconds: 14,
      raw: { mean: 1.2, changed: 0.04 },
      denoised: { seconds: 15, change: { mean: 0.2, changed: 0.003 } },
    },
    {
      samples: 128,
      seconds: 26,
      raw: { mean: 0.6, changed: 0.006 },
      denoised: { seconds: 27, change: { mean: 0.1, changed: 0.001 } },
    },
    {
      samples: 256,
      seconds: 50,
      raw: { mean: 0.3, changed: 0.001 },
      denoised: { seconds: 51, change: { mean: 0.1, changed: 0.0005 } },
    },
  ],
  samples: 256,
  seconds: 51,
  timedOut: false,
  denoised: true,
  ...over,
});

/** A view measured without the denoiser (`&weights=none`): raw images only. */
const raw = (over: Partial<ViewMeasurement> = {}): ViewMeasurement =>
  view({
    denoised: false,
    checkpoints: view().checkpoints.map(({ samples, seconds, raw }) => ({
      samples,
      seconds,
      ...(raw && { raw }),
    })),
    ...over,
  });

const context: GateContext = {
  commit: '0123456789abcdef',
  time: new Date('2026-11-25T12:00:00Z'),
  browser: 'TestBrowser/1',
  adapter: 'vendor, arch',
  graphics: 'A card',
  width: 1920,
  height: 1080,
  samples: 256,
  bounces: 8,
  limit: 180,
  kernel: 'wavefront',
  denoiser: 'small weights, 641.5 kB, downloaded with its code in 0.4 s',
  chunks: [
    {
      name: 'render-path',
      size: { served: 296_900, encoding: 'gzip', decoded: 1_064_400, gzip: 296_200 },
    },
    { name: 'render-denoise', size: undefined },
  ],
};

describe('the gate of render mode', () => {
  it('keeps the image at the target and its halves down to 16 samples', () => {
    expect(checkpoints(256)).toEqual([16, 32, 64, 128, 256]);
    expect(checkpoints(100)).toEqual([25, 50, 100]);
    expect(checkpoints(8)).toEqual([8]);
  });

  it('measures how two images differ, leaving the alpha out', () => {
    const a = [10, 10, 10, 255, 100, 100, 100, 255];
    const b = [10, 13, 10, 0, 100, 100, 109, 255];
    const { mean, changed } = imageDifference(a, b);
    // 3 + 9 levels over two pixels of three channels; one pixel changed by more than 4.
    expect(mean).toBeCloseTo(2, 6);
    expect(changed).toBe(0.5);
    expect(imageDifference([], [])).toEqual({ mean: 0, changed: 0 });
  });

  it('calls an image clean when twice the samples change under 1 % of its pixels', () => {
    // Raw, 64 to 128 samples changed 0.6 %: the image at 64 was clean, after 14 s.
    expect(cleanAt(view().checkpoints, 'raw')).toEqual({ samples: 64, seconds: 14 });
    // Denoised, 16 to 32 changed 0.8 %: the denoised image at 16 was, when it was ready.
    expect(cleanAt(view().checkpoints, 'denoised')).toEqual({ samples: 16, seconds: 5 });
    expect(passes(view())).toBe(true);
  });

  it('judges the denoised still when there is one, the raw image otherwise (D114)', () => {
    // Denoised clean in time, raw too late: a denoised run passes, a raw one does not.
    const late = view().checkpoints.map((p) => ({ ...p, seconds: p.seconds * 5 }));
    const lateRaw = late.map((p) => ({
      ...p,
      denoised: { ...p.denoised!, seconds: p.seconds / 5 + 1 },
    }));
    expect(passes(view({ checkpoints: lateRaw }))).toBe(true);
    expect(
      passes(
        raw({
          checkpoints: late.map(({ samples, seconds, raw }) => ({
            samples,
            seconds,
            ...(raw && { raw }),
          })),
        }),
      ),
    ).toBe(false);
    expect(cleanAt(raw().checkpoints, 'denoised')).toBeUndefined();
    expect(passes(raw())).toBe(true);
  });

  it('fails a view that is clean too late, or never', () => {
    const slow = view().checkpoints.map((p) => ({
      ...p,
      denoised: { ...p.denoised!, seconds: p.denoised!.seconds * 20 },
    }));
    expect(passes(view({ checkpoints: slow }))).toBe(false);
    const noisy = view().checkpoints.map((p) => ({
      ...p,
      denoised: { seconds: p.denoised!.seconds, change: { mean: 3, changed: 0.3 } },
    }));
    expect(cleanAt(noisy)).toBeUndefined();
    expect(passes(view({ checkpoints: noisy }))).toBe(false);
    expect(cleanAt([{ samples: 16, seconds: 1 }])).toBeUndefined();
  });

  it('averages the seconds the denoiser took a still', () => {
    expect(denoiseSeconds(view().checkpoints)).toBe(1);
    expect(denoiseSeconds(raw().checkpoints)).toBeUndefined();
  });

  it("reads a chunk's budget from bundle-budget.json", () => {
    expect(chunkBudget('render-path')).toBe(budget.lazy['render-path'].maxGzipBytes);
    expect(chunkBudget('render-denoise')).toBe(budget.lazy['render-denoise'].maxGzipBytes);
    expect(chunkBudget('nothing')).toBeUndefined();
  });

  it('reports the machine, each view and each checkpoint as markdown', () => {
    const report = gateReport(context, [
      view(),
      view({ view: 'section', checkpoints: [], samples: 40, seconds: 180, timedOut: true }),
      view({ view: 'eye', checkpoints: [], error: 'device lost' }),
    ]);
    expect(report).toContain('| Commit | 0123456 |');
    expect(report).toContain('| Graphics (WebGL) | A card |');
    const kB = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB`;
    expect(report).toContain(
      `| \`render-path\`, gzipped as CI measures it (budget ${kB(budget.lazy['render-path'].maxGzipBytes)}) | 296.2 kB |`,
    );
    expect(report).toContain('| `render-path`, as the server sent it | 296.9 kB (gzip) |');
    expect(report).toContain('| `render-path`, uncompressed | 1064.4 kB |');
    expect(report).toContain('| `render-denoise` chunk | not reported |');
    expect(report).toContain(
      '| Denoiser | small weights, 641.5 kB, downloaded with its code in 0.4 s |',
    );
    expect(report).toContain(
      '| cutaway | 5.0 s at 16 samples | 14.0 s at 64 samples | 256 samples in 51.0 s | 2.1 s | 1.0 s |',
    );
    expect(report).toContain('| pass |');
    expect(report).toContain(
      '| section | not reached | not reached | 40 samples in 180.0 s (time limit) |',
    );
    expect(report).toContain('failed: device lost');
    expect(report).toContain('| cutaway | 128 | 26.0 | 27.0 | 0.10 % | 0.10 | 0.60 % | 0.60 |');
    expect(report).toContain('| cutaway | 16 | 4.0 | 5.0 |  |  |  |  |');
    const rawReport = gateReport({ ...context, denoiser: 'none' }, [raw()]);
    expect(rawReport).toContain('| cutaway | not denoised | 14.0 s at 64 samples |');
    expect(rawReport).toContain('| cutaway | 64 | 14.0 |  |  |  | 4.00 % | 1.20 |');
  });
});
