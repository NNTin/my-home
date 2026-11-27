import type { PerspectiveCamera } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TraceScene } from './traceScene';

/**
 * The tracer's denoising at every checkpoint (D114), against stand-ins for the WebGPU renderer,
 * the library's tracer and its denoiser: the agents' machine cannot run them (D99). The tests
 * play the library's part by hand: its "progress" and "complete" events, then a frame.
 */

interface Listener {
  (event: Record<string, unknown>): void;
}

class FakeEvents {
  private listeners = new Map<string, Listener[]>();
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  dispatchEvent(event: Record<string, unknown> & { type: string }) {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
  }
}

const made = vi.hoisted(() => ({
  tracers: [] as unknown[],
  denoisers: [] as unknown[],
}));

vi.mock('three/webgpu', () => ({
  NeutralToneMapping: 7,
  WebGPURenderer: class {
    domElement: HTMLCanvasElement;
    onDeviceLost: ((info: { message: string; reason: string }) => void) | undefined;
    toneMapping = 0;
    toneMappingExposure = 1;
    constructor({ canvas }: { canvas: HTMLCanvasElement }) {
      this.domElement = canvas;
    }
    async init() {}
    setPixelRatio() {}
    setSize() {}
    setClearColor() {}
    dispose() {}
  },
}));

vi.mock('three-gpu-pathtracer/webgpu', () => {
  class FakeDenoiser extends FakeEvents {
    running = false;
    disposed = false;
    constructor(readonly options: Record<string, unknown>) {
      super();
      made.denoisers.push(this);
    }
    dispose() {
      this.disposed = true;
    }
  }
  class FakeTracer extends FakeEvents {
    maxSamples = 0;
    maxBounces = 0;
    pause = false;
    dynamicLowRes = true;
    renderDelay = 100;
    fadeDuration = 500;
    synchronizeRenderSize = true;
    asyncCompile = false;
    _denoiser: unknown = null;
    /** The denoiser each presentation was made with, and the targets the tracer was given. */
    presented: unknown[] = [];
    targets: number[] = [];
    resets = 0;
    constructor() {
      super();
      made.tracers.push(this);
      let target = 0;
      Object.defineProperty(this, 'maxSamples', {
        get: () => target,
        set: (value: number) => {
          target = value;
          this.targets.push(value);
        },
      });
    }
    setDenoiser(denoiser: unknown) {
      this._denoiser = denoiser;
      this.resets += 1;
    }
    setSize() {}
    setScene() {}
    renderSample() {
      this.presented.push(this._denoiser);
    }
    async getSampleCountsAsync() {
      return { min: 0, max: 0, avg: 0, samplesPerSecond: 0 };
    }
    dispose() {}
  }
  return { WebGPUPathTracer: FakeTracer, OIDNDenoiser: FakeDenoiser };
});

const renderDenoise = vi.hoisted(() => ({
  initUNetFromBuffer: vi.fn(async (file: ArrayBuffer, _backend: unknown, _options: unknown) => ({
    file,
  })),
}));
vi.mock('./render-denoise', () => ({
  WEIGHTS: { small: '/assets/oidn-small-x.tza', default: '/assets/oidn-default-x.tza' },
  initUNetFromBuffer: renderDenoise.initUNetFromBuffer,
}));

const { Trace, loadDenoiser } = await import('./tracer');
type FakeTracer = {
  maxSamples: number;
  pause: boolean;
  _denoiser: unknown;
  presented: unknown[];
  targets: number[];
  resets: number;
  dispatchEvent(event: Record<string, unknown> & { type: string }): void;
};
type FakeDenoiser = {
  running: boolean;
  disposed: boolean;
  options: Record<string, unknown>;
  dispatchEvent(event: Record<string, unknown> & { type: string }): void;
};

/** The animation frames asked for, run by hand. */
let frames: FrameRequestCallback[] = [];
beforeEach(() => {
  frames = [];
  made.tracers.length = 0;
  made.denoisers.length = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
});
const frame = () => {
  const now = frames;
  frames = [];
  for (const callback of now) callback(0);
};

const source = {
  weights: 'small' as const,
  bytes: 641_480,
  seconds: 0.4,
  initUNetFromURL: () => undefined,
};
const scene = { scene: {}, exposure: 1 } as unknown as TraceScene;

async function traced(denoiser: typeof source | null = source, samples = 256) {
  let time = 0;
  const trace = await Trace.create(
    document.createElement('canvas'),
    { width: 16, height: 16, samples, bounces: 8, denoiser: denoiser ?? undefined },
    () => (time += 100),
  );
  const tracer = made.tracers.at(-1) as FakeTracer;
  const checkpoints: { samples: number; denoised: boolean }[] = [];
  trace.onCheckpoint = ({ samples, denoised }) => checkpoints.push({ samples, denoised });
  trace.start(scene, {} as PerspectiveCamera);
  /** The library: every pixel has `min` samples, and, at its target, the denoiser has run. */
  const reach = (min: number) => {
    tracer.dispatchEvent({
      type: 'progress',
      stage: 'rendering',
      samples: { min, max: min, avg: min, samplesPerSecond: 1 },
    });
    if (min >= tracer.maxSamples) tracer.dispatchEvent({ type: 'complete' });
    frame();
  };
  return { trace, tracer, checkpoints, reach };
}

describe('the tracer with its denoiser', () => {
  it('stops at every checkpoint for a denoised image, then goes on to the next', async () => {
    const { trace, tracer, checkpoints, reach } = await traced();
    const denoiser = made.denoisers[0] as FakeDenoiser;
    // The library's denoiser, given the weights already downloaded.
    expect(tracer._denoiser).toBe(denoiser);
    expect(denoiser.options.initUNetFromURL).toBe(source.initUNetFromURL);
    expect(trace.denoised).toBe(true);
    expect(tracer.maxSamples).toBe(16);
    for (const samples of [8, 16, 24, 32, 64, 128]) reach(samples);
    expect(checkpoints).toEqual([16, 32, 64, 128].map((samples) => ({ samples, denoised: true })));
    expect(tracer.maxSamples).toBe(256);
    expect(trace.running).toBe(true);
    reach(256);
    expect(checkpoints.at(-1)).toEqual({ samples: 256, denoised: true });
    expect(trace.progress).toMatchObject({ done: true, samples: 256 });
    expect(trace.running).toBe(false);
    // Done: no frame is asked for any more.
    expect(frames).toEqual([]);
  });

  it('says "denoising" while a pass runs', async () => {
    const { trace, tracer } = await traced();
    tracer.dispatchEvent({ type: 'progress', stage: 'denoising', progress: 0.5 });
    expect(trace.progress.stage).toBe('denoising');
  });

  it('"Stop" denoises the samples there are, as a last checkpoint', async () => {
    const { trace, tracer, checkpoints, reach } = await traced();
    reach(16);
    reach(24);
    trace.finish();
    expect(tracer.pause).toBe(true);
    expect(tracer.maxSamples).toBe(24);
    expect(trace.running).toBe(false);
    expect(trace.settling).toBe(true);
    reach(24);
    expect(checkpoints.at(-1)).toEqual({ samples: 24, denoised: true });
    expect(trace.settling).toBe(false);
    expect(trace.progress.done).toBe(false);
    expect(frames).toEqual([]);
  });

  it('"Stop" right at a checkpoint keeps that image', async () => {
    const { trace, tracer, checkpoints, reach } = await traced();
    reach(16);
    trace.finish();
    expect(trace.settling).toBe(false);
    expect(tracer.targets.at(-1)).toBe(32);
    expect(checkpoints).toHaveLength(1);
  });

  it('"Stop" while a checkpoint is denoised ends with that one', async () => {
    const { trace, tracer, checkpoints, reach } = await traced();
    reach(16);
    reach(32 - 1);
    (made.denoisers[0] as FakeDenoiser).running = true;
    trace.finish();
    // The pass at 32 is not dropped: the target stays.
    expect(tracer.maxSamples).toBe(32);
    (made.denoisers[0] as FakeDenoiser).running = false;
    reach(32);
    expect(checkpoints.at(-1)).toEqual({ samples: 32, denoised: true });
    expect(trace.settling).toBe(false);
  });

  it('"Stop" before the first sample, or without a denoiser, stops at once', async () => {
    const first = await traced();
    first.trace.finish();
    expect(first.trace.settling).toBe(false);
    expect(first.trace.running).toBe(false);
    const raw = await traced(null);
    raw.reach(20);
    raw.trace.finish();
    expect(raw.trace.settling).toBe(false);
    expect(raw.checkpoints).toEqual([{ samples: 16, denoised: false }]);
  });

  it('gives the raw image at a checkpoint by setting the denoiser aside once', async () => {
    const { trace, tracer } = await traced();
    const context = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    trace.captureRaw(context);
    trace.capture(context);
    expect(tracer.presented.slice(-2)).toEqual([null, made.denoisers[0]]);
    expect(tracer._denoiser).toBe(made.denoisers[0]);
  });

  it('without a denoiser, checkpoints are raw images', async () => {
    const { trace, tracer, checkpoints, reach } = await traced(null, 32);
    expect(made.denoisers).toHaveLength(0);
    expect(trace.denoised).toBe(false);
    reach(16);
    reach(32);
    expect(checkpoints).toEqual([
      { samples: 16, denoised: false },
      { samples: 32, denoised: false },
    ]);
    expect(tracer.resets).toBe(0);
  });

  it('a denoiser that fails is dropped: the still starts over raw, and says why', async () => {
    const { trace, tracer, checkpoints, reach } = await traced();
    reach(16);
    reach(20);
    const denoiser = made.denoisers[0] as FakeDenoiser;
    denoiser.dispatchEvent({ type: 'error', error: new Error('no weights') });
    expect(trace.denoiseError).toBe('no weights');
    expect(trace.denoised).toBe(false);
    expect(denoiser.disposed).toBe(true);
    expect(tracer._denoiser).toBeNull();
    expect(tracer.maxSamples).toBe(16);
    expect(trace.progress.samples).toBe(0);
    reach(16);
    expect(checkpoints.at(-1)).toEqual({ samples: 16, denoised: false });
  });
});

describe("the denoiser's download", () => {
  it('fetches the weights once, with the chunk, and gives each network a copy', async () => {
    const file = new ArrayBuffer(8);
    const fetched = vi.fn(async () => new Response(file));
    vi.stubGlobal('fetch', fetched);
    let time = 0;
    const loaded = await loadDenoiser('default', () => (time += 250));
    expect(fetched).toHaveBeenCalledWith('/assets/oidn-default-x.tza');
    expect(loaded).toMatchObject({ weights: 'default', bytes: 8, seconds: 0.25 });
    expect(await loadDenoiser('default')).toBe(loaded);
    expect(fetched).toHaveBeenCalledTimes(1);
    const backend = { device: {} as GPUDevice };
    await loaded.initUNetFromURL('ignored', backend, { aux: true });
    const [given, gave, options] = renderDenoise.initUNetFromBuffer.mock.calls[0]!;
    expect(given).not.toBe(file);
    expect(given.byteLength).toBe(8);
    expect(gave).toBe(backend);
    expect(options).toEqual({ aux: true });
  });

  it('forgets a failed download, so that the next still tries again', async () => {
    const fetched = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(new ArrayBuffer(4)));
    vi.stubGlobal('fetch', fetched);
    await expect(loadDenoiser('small')).rejects.toThrow('HTTP 404');
    await expect(loadDenoiser('small')).resolves.toMatchObject({ bytes: 4 });
    expect(fetched).toHaveBeenCalledTimes(2);
  });
});
