import type { PerspectiveCamera } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { statusText } from './RenderStill';
import { NO_PROGRESS, Still, stillSize, type StillParts } from './still';
import type {
  DenoiserSource,
  Trace,
  TraceCheckpoint,
  TraceProgress,
  TraceSettings,
} from './tracer';
import type { TraceScene } from './traceScene';
import type { TraceInputs } from '../views/traceInputs';

describe('a still of render mode', () => {
  it('has a pixel for each CSS pixel of the view, at most 1920 wide', () => {
    expect(stillSize(1280, 720)).toEqual({ width: 1280, height: 720 });
    expect(stillSize(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(stillSize(2560, 1440)).toEqual({ width: 1920, height: 1080 });
    expect(stillSize(0, 0)).toEqual({ width: 16, height: 16 });
  });

  it('says how far it is', () => {
    expect(statusText(NO_PROGRESS)).toBe('Preparing the scene');
    expect(statusText({ ...NO_PROGRESS, stage: 'compiling', seconds: 3.2 })).toBe(
      'Preparing the tracer, 3 s',
    );
    const tracing = { ...NO_PROGRESS, stage: 'rendering' as const, samples: 96, seconds: 22.6 };
    expect(statusText(tracing)).toBe('Rendering: 96 of 256 samples, 23 s');
    expect(statusText({ ...tracing, running: false })).toBe('Stopped at 96 of 256 samples, 23 s');
    expect(statusText({ ...tracing, samples: 256, done: true, running: false, seconds: 41 })).toBe(
      'Done: 256 samples in 41 s',
    );
    expect(statusText({ ...tracing, stage: 'denoising', samples: 64 })).toBe(
      'Denoising at 64 of 256 samples, 23 s',
    );
    expect(statusText({ ...tracing, running: false, settling: true })).toBe(
      'Stopped at 96 of 256 samples, 23 s: denoising',
    );
    expect(statusText({ ...tracing, undenoised: 'HTTP 404' })).toBe(
      'Rendering: 96 of 256 samples, 23 s (not denoised)',
    );
  });
});

/** A wait a test ends by hand: the texture files, or the tracer being made. */
function gate() {
  let open!: () => void;
  const waited = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { waited, open };
}

/** A still whose tracer and texture files are stand-ins, with what happened to them. */
function fakeStill(host = document.createElement('div')) {
  const textures = gate();
  const tracer = gate();
  const log = {
    started: [] as string[],
    created: 0,
    built: 0,
    disposedScenes: 0,
    droppedMeshes: 0,
    finished: 0,
    settings: [] as TraceSettings[],
    denoiserLoads: 0,
  };
  const denoiser = {
    weights: 'small',
    bytes: 641_480,
    seconds: 0.2,
    initUNetFromURL: () => undefined,
  } as DenoiserSource;
  let denoiserLoad: () => Promise<DenoiserSource> = async () => denoiser;
  let settling = false;
  let progress: TraceProgress = { stage: 'building', samples: 0, average: 0, done: false };
  let stopped = true;
  const trace = {
    settings: { width: 16, height: 16, samples: 256, bounces: 8 },
    lost: undefined,
    get progress() {
      return progress;
    },
    get running() {
      return !stopped;
    },
    get settling() {
      return settling;
    },
    denoised: true,
    denoiseError: undefined,
    onCheckpoint: undefined as ((checkpoint: TraceCheckpoint) => void) | undefined,
    capture: vi.fn(),
    finish() {
      log.finished += 1;
      stopped = true;
      settling = true;
    },
    start(built: TraceScene) {
      stopped = false;
      progress = { stage: 'rendering', samples: 4, average: 4, done: false };
      log.started.push(built.backdrop);
    },
    stop() {
      stopped = true;
    },
    dispose: vi.fn(),
  } as unknown as Trace;
  const parts: StillParts = {
    meshes: () => [
      {
        key: 'mesh',
        geometry: { dispose: () => (log.droppedMeshes += 1) },
        finish: 'part',
        material: undefined,
        castShadow: true,
      } as never,
    ],
    texturesArrived: () => textures.waited,
    build: (inputs) => {
      log.built += 1;
      return {
        // The view the scene was built for, to tell which one was started.
        backdrop: (inputs as unknown as { name: string }).name,
        backdropColors: { top: '#ffffff', bottom: '#ffffff' },
        dispose: () => (log.disposedScenes += 1),
      } as unknown as TraceScene;
    },
    createTrace: async (_canvas, settings) => {
      log.created += 1;
      log.settings.push(settings);
      await tracer.waited;
      return trace;
    },
    loadDenoiser: () => {
      log.denoiserLoads += 1;
      return denoiserLoad();
    },
  };
  const still = new Still(host, () => 0, parts);
  const show = (name: string) =>
    still.show({ name, materials: {} } as unknown as TraceInputs, {
      camera: {} as PerspectiveCamera,
      width: 16,
      height: 16,
    });
  /** Lets everything that is waiting run to its end. */
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  /** The tracer at a checkpoint, as it tells of one. */
  const checkpoint = (samples: number, denoised = true) => {
    settling = false;
    trace.onCheckpoint?.({ samples, denoised, reached: 0, ready: 0 });
  };
  const failDenoiser = (error: Error) => {
    denoiserLoad = () => Promise.reject(error);
    (trace as { denoised: boolean }).denoised = false;
  };
  return { still, show, settle, textures, tracer, log, trace, checkpoint, failDenoiser, denoiser };
}

describe('starting and stopping a still', () => {
  it('starts once its textures and its tracer are there', async () => {
    const { still, show, settle, textures, tracer, log } = fakeStill();
    show('cutaway');
    expect(still.progress()).toMatchObject({ running: true, samples: 0 });
    textures.open();
    tracer.open();
    await settle();
    expect(log.started).toEqual(['cutaway']);
    expect(still.progress()).toMatchObject({ running: true, stage: 'rendering', samples: 4 });
    expect(still.hasImage).toBe(true);
  });

  it('"Stop" while the textures are on their way starts nothing', async () => {
    const { still, show, settle, textures, tracer, log } = fakeStill();
    show('cutaway');
    await settle();
    still.stop();
    expect(still.progress().running).toBe(false);
    textures.open();
    tracer.open();
    await settle();
    expect(log.started).toEqual([]);
    expect(log.created).toBe(0);
    expect(log.built).toBe(0);
    expect(log.droppedMeshes).toBe(1);
    expect(still.progress()).toMatchObject({ running: false, samples: 0 });
    expect(still.hasImage).toBe(false);
  });

  it('"Stop" while the tracer is being made starts nothing, and keeps the tracer', async () => {
    const { still, show, settle, textures, tracer, log } = fakeStill();
    show('cutaway');
    textures.open();
    await settle();
    expect(log.created).toBe(1);
    still.stop();
    tracer.open();
    await settle();
    expect(log.started).toEqual([]);
    expect(log.built).toBe(0);
    expect(still.progress().running).toBe(false);
    // "Render" on another view afterwards uses the tracer that was made.
    show('section');
    await settle();
    expect(log.created).toBe(1);
    expect(log.started).toEqual(['section']);
    expect(still.progress().running).toBe(true);
  });

  it('a view changed while the first is prepared traces the last one only', async () => {
    const { show, settle, textures, tracer, log } = fakeStill();
    show('cutaway');
    await settle();
    show('section');
    show('eye');
    textures.open();
    tracer.open();
    await settle();
    expect(log.started).toEqual(['eye']);
    expect(log.built).toBe(1);
  });

  it('a new view after the first has started replaces its scene', async () => {
    const { show, settle, textures, tracer, log } = fakeStill();
    textures.open();
    tracer.open();
    show('cutaway');
    await settle();
    show('section');
    await settle();
    expect(log.started).toEqual(['cutaway', 'section']);
    expect(log.created).toBe(1);
    expect(log.disposedScenes).toBe(1);
  });

  it('"Stop" before a new view of the same size started keeps no image of the view before', async () => {
    const { still, show, settle, textures, tracer, log } = fakeStill();
    textures.open();
    tracer.open();
    show('cutaway');
    await settle();
    expect(still.hasImage).toBe(true);
    // The next view has the same size: the tracer, with the cutaway's image, is kept for it.
    show('section');
    still.stop();
    await settle();
    expect(log.started).toEqual(['cutaway']);
    expect(still.hasImage).toBe(false);
    await expect(still.image()).rejects.toThrow('nothing is traced yet');
    expect(still.progress()).toMatchObject({ running: false, samples: 0, done: false });
    // "Render" on it again traces it, and that image is the still.
    show('section');
    await settle();
    expect(log.started).toEqual(['cutaway', 'section']);
    expect(still.hasImage).toBe(true);
  });

  it('hides the image of the view before until the new view has its first sample', async () => {
    const host = document.createElement('div');
    const { still, show, settle, textures, tracer } = fakeStill(host);
    textures.open();
    tracer.open();
    show('cutaway');
    await settle();
    still.progress();
    expect(host.style.visibility).toBe('');
    show('section');
    expect(host.style.visibility).toBe('hidden');
    await settle();
    still.progress();
    expect(host.style.visibility).toBe('');
  });

  it('closed while it is prepared, it starts nothing and frees the tracer', async () => {
    const { still, show, settle, textures, tracer, log } = fakeStill();
    show('cutaway');
    textures.open();
    await settle();
    still.dispose();
    tracer.open();
    await settle();
    expect(log.started).toEqual([]);
    expect(log.built).toBe(0);
  });
});

/** A 2D context that records what is drawn into it: jsdom has none. */
function fakeCanvases() {
  const drawn: unknown[] = [];
  const context = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    drawImage: (image: unknown) => drawn.push(image),
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    fillStyle: '',
    canvas: { width: 16, height: 16 },
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) =>
    done(new Blob(['png'])),
  );
  return { drawn, context };
}

describe('the denoised still on screen', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is traced with the small weights, downloaded while the textures are', async () => {
    const { show, settle, textures, tracer, log, denoiser } = fakeStill();
    show('cutaway');
    await settle();
    // Asked for before the textures have arrived.
    expect(log.denoiserLoads).toBe(1);
    textures.open();
    tracer.open();
    await settle();
    expect(log.settings[0]?.denoiser).toBe(denoiser);
  });

  it('a denoiser that does not load leaves the still raw, and says why', async () => {
    const { still, show, settle, textures, tracer, log, failDenoiser } = fakeStill();
    failDenoiser(new Error('HTTP 404'));
    show('cutaway');
    textures.open();
    tracer.open();
    await settle();
    expect(log.started).toEqual(['cutaway']);
    expect(log.settings[0]?.denoiser).toBeUndefined();
    expect(still.progress().undenoised).toBe('HTTP 404');
  });

  it('shows the denoised image of each checkpoint over the raw samples, and saves it', async () => {
    const host = document.createElement('div');
    const { drawn } = fakeCanvases();
    const { still, show, settle, textures, tracer, trace, checkpoint } = fakeStill(host);
    textures.open();
    tracer.open();
    show('cutaway');
    await settle();
    const [traced, denoised] = [...host.children] as HTMLCanvasElement[];
    // Before the first checkpoint the raw samples show.
    expect(traced!.style.visibility).toBe('');
    expect(denoised!.style.visibility).toBe('hidden');
    expect(still.progress().denoised).toBe(0);
    checkpoint(16);
    expect(trace.capture).toHaveBeenCalledTimes(1);
    expect(traced!.style.visibility).toBe('hidden');
    expect(denoised!.style.visibility).toBe('');
    expect(still.progress().denoised).toBe(16);
    // "Save image" draws the denoised image over the backdrop, not the tracer's raw one.
    drawn.length = 0;
    await still.image();
    expect(drawn).toEqual([denoised]);
    expect(trace.capture).toHaveBeenCalledTimes(1);
  });

  it("a raw checkpoint (no denoiser) leaves the tracer's canvas on screen", async () => {
    const host = document.createElement('div');
    fakeCanvases();
    const { still, show, settle, textures, tracer, checkpoint } = fakeStill(host);
    textures.open();
    tracer.open();
    show('cutaway');
    await settle();
    checkpoint(16, false);
    expect(still.progress().denoised).toBe(0);
    expect((host.firstElementChild as HTMLElement).style.visibility).toBe('');
  });

  it('a denoiser that fails mid-still takes its stale image off screen, and out of Save image', async () => {
    const host = document.createElement('div');
    const { drawn } = fakeCanvases();
    const { still, show, settle, textures, tracer, trace, checkpoint } = fakeStill(host);
    textures.open();
    tracer.open();
    show('cutaway');
    await settle();
    const [traced, denoised] = [...host.children] as HTMLCanvasElement[];
    checkpoint(16);
    expect(still.progress().denoised).toBe(16);
    // The network fails: the tracer drops it and starts over raw.
    Object.assign(trace, { denoised: false, denoiseError: 'the network failed' });
    expect(still.progress()).toMatchObject({ denoised: 0, undenoised: 'the network failed' });
    expect(traced!.style.visibility).toBe('');
    expect(denoised!.style.visibility).toBe('hidden');
    // Saved: the tracer's raw image, not the dropped denoised one.
    drawn.length = 0;
    await still.image();
    expect(drawn).not.toContain(denoised);
    expect(trace.capture).toHaveBeenCalledTimes(2);
  });

  it('a raw checkpoint after a denoised one puts the raw image back on screen', async () => {
    const host = document.createElement('div');
    fakeCanvases();
    const { still, show, settle, textures, tracer, checkpoint } = fakeStill(host);
    textures.open();
    tracer.open();
    show('cutaway');
    await settle();
    checkpoint(16);
    checkpoint(16, false);
    expect(still.progress().denoised).toBe(0);
    expect((host.children[0] as HTMLElement).style.visibility).toBe('');
    expect((host.children[1] as HTMLElement).style.visibility).toBe('hidden');
  });

  it('a new view hides the denoised image of the one before', async () => {
    const host = document.createElement('div');
    fakeCanvases();
    const { still, show, settle, textures, tracer, trace, checkpoint } = fakeStill(host);
    textures.open();
    tracer.open();
    show('cutaway');
    await settle();
    const before = trace.onCheckpoint;
    checkpoint(32);
    show('section');
    expect(still.progress().denoised).toBe(0);
    expect((host.children[1] as HTMLElement).style.visibility).toBe('hidden');
    // The cutaway's tracer telling of a checkpoint late is not the section's image.
    before?.({ samples: 64, denoised: true, reached: 0, ready: 0 });
    expect(still.progress().denoised).toBe(0);
    await settle();
    expect(still.progress().denoised).toBe(0);
  });

  it('"Stop" denoises the samples there are; Save image waits for it', async () => {
    fakeCanvases();
    const { still, show, settle, textures, tracer, log, checkpoint } = fakeStill();
    textures.open();
    tracer.open();
    show('cutaway');
    await settle();
    still.stop();
    expect(log.finished).toBe(1);
    expect(still.progress()).toMatchObject({ running: false, settling: true });
    checkpoint(4);
    expect(still.progress()).toMatchObject({ running: false, settling: false, denoised: 4 });
  });
});
