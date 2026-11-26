import { describe, expect, it } from 'vitest';
import {
  checkpoints,
  cleanAt,
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
  checkpoints: [
    { samples: 16, seconds: 4 },
    { samples: 32, seconds: 7, mean: 2.5, changed: 0.2 },
    { samples: 64, seconds: 13, mean: 1.2, changed: 0.04 },
    { samples: 128, seconds: 25, mean: 0.6, changed: 0.006 },
    { samples: 256, seconds: 49, mean: 0.3, changed: 0.001 },
  ],
  samples: 256,
  seconds: 49,
  timedOut: false,
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
  chunk: { served: 356_940, encoding: 'gzip', decoded: 1_064_400, gzip: 296_200 },
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
    // 64 to 128 samples changed 0.6 %: the image at 64 was clean.
    expect(cleanAt(view().checkpoints)?.samples).toBe(64);
    expect(passes(view())).toBe(true);
  });

  it('fails a view that is clean too late, or never', () => {
    const slow = view().checkpoints.map((p) => ({ ...p, seconds: p.seconds * 6 }));
    expect(passes(view({ checkpoints: slow }))).toBe(false);
    const noisy = view().checkpoints.map((p) => ({ ...p, changed: p.changed && 0.3 }));
    expect(cleanAt(noisy)).toBeUndefined();
    expect(passes(view({ checkpoints: noisy }))).toBe(false);
    expect(cleanAt([{ samples: 16, seconds: 1 }])).toBeUndefined();
  });

  it('reports the machine, each view and each checkpoint as markdown', () => {
    const report = gateReport(context, [
      view(),
      view({ view: 'section', checkpoints: [], samples: 40, seconds: 180, timedOut: true }),
      view({ view: 'eye', checkpoints: [], error: 'device lost' }),
    ]);
    expect(report).toContain('| Commit | 0123456 |');
    expect(report).toContain('| Graphics (WebGL) | A card |');
    expect(report).toContain(
      '| `render-path`, gzipped as CI measures it (budget 340 kB) | 296.2 kB |',
    );
    expect(report).toContain('| `render-path`, as the server sent it | 356.9 kB (gzip) |');
    expect(report).toContain('| `render-path`, uncompressed | 1064.4 kB |');
    expect(gateReport({ ...context, chunk: undefined }, [])).toContain(
      '| `render-path` chunk | not reported |',
    );
    expect(report).toContain('| cutaway | 13.0 s at 64 samples | 256 samples in 49.0 s |');
    expect(report).toContain('| pass |');
    expect(report).toContain('| section | not reached | 40 samples in 180.0 s (time limit) |');
    expect(report).toContain('failed: device lost');
    expect(report).toContain('| cutaway | 128 | 25.0 | 0.60 % | 0.60 |');
  });
});
