import type { PerspectiveCamera } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { statusText } from './RenderStill';
import { NO_PROGRESS, Still, stillSize, type StillParts } from './still';
import type { Trace, TraceProgress } from './tracer';
import type { TraceInputs, TraceScene } from './traceScene';

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
  };
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
        dispose: () => (log.disposedScenes += 1),
      } as unknown as TraceScene;
    },
    createTrace: async () => {
      log.created += 1;
      await tracer.waited;
      return trace;
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
  return { still, show, settle, textures, tracer, log };
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
