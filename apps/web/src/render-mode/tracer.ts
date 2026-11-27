import { NeutralToneMapping, WebGPURenderer, type PerspectiveCamera } from 'three/webgpu';
import {
  OIDNDenoiser,
  WebGPUPathTracer,
  type OIDNDenoiserOptions,
  type SampleCounts,
} from 'three-gpu-pathtracer/webgpu';
import { checkpoints } from './measure';
import type { TraceScene } from './traceScene';

/**
 * The path tracer of render mode (docs/design/realistic-render.md §9): `three-gpu-pathtracer`'s
 * WebGPU tracer on a WebGPU renderer of its own, in a canvas of its own. It shares no GPU object
 * with the viewer, whose WebGL context stays as it is underneath.
 *
 * With a denoiser (D114) the tracer stops at every checkpoint (16, 32, 64, ... samples a pixel,
 * `checkpoints`), the library runs Open Image Denoise over the image, and `onCheckpoint` is told
 * while the denoised image is on the canvas; then the samples go on to the next checkpoint. The
 * library would denoise only at the sample target by itself: its target is moved from one
 * checkpoint to the next, which keeps the samples already made.
 */

/** The weights of the denoiser's network: render mode's, or the measuring page's larger ones. */
export type Weights = 'small' | 'default';

/** The denoiser's network, its weights already downloaded (`loadDenoiser`). */
export interface DenoiserSource {
  weights: Weights;
  /** The weights file's size, in bytes, and the seconds its download took. */
  bytes: number;
  seconds: number;
  /** `oidn-webgpu`'s `initUNetFromURL` for the library, over the downloaded file. */
  initUNetFromURL: OIDNDenoiserOptions['initUNetFromURL'];
}

export interface TraceSettings {
  /** The image, in pixels. */
  width: number;
  height: number;
  /** Samples per pixel at which the still is done (§9: 256). */
  samples: number;
  /** How often a path may scatter. */
  bounces: number;
  /**
   * The library's other backend: one kernel for a whole path instead of the wavefront's stages.
   * The wavefront is its default; which is faster depends on the graphics card.
   */
  megakernel?: boolean;
  /** The denoiser; without it every image is the raw one. */
  denoiser?: DenoiserSource | undefined;
}

/** The sample target of §9. */
export const SAMPLE_TARGET = 256;
/**
 * Scatterings per path. Daylight in a room is the light of its second to fourth bounce; beyond
 * eight a path adds less than the noise that is left at the sample target.
 */
export const BOUNCES = 8;

export type TraceStage = 'building' | 'compiling' | 'rendering' | 'denoising';

/** What the tracer says while it works: the stage, and once it renders the samples of the image. */
export interface TraceProgress {
  stage: TraceStage;
  /** The fewest samples any pixel has: what "done" is measured by. */
  samples: number;
  average: number;
  done: boolean;
}

/** A checkpoint reached: the image on the canvas now has `samples` a pixel. */
export interface TraceCheckpoint {
  samples: number;
  /** Whether the image on the canvas is the denoised one. */
  denoised: boolean;
  /** When every pixel was seen to have the samples, and when the image was ready (`performance.now()`). */
  reached: number;
  ready: number;
}

const DENOISERS = new Map<Weights, Promise<DenoiserSource>>();

/**
 * The denoiser's code (the lazy chunk `render-denoise`) and its weights, downloaded once a page.
 * A failed download is forgotten, so that the next still tries again.
 */
export function loadDenoiser(
  weights: Weights = 'small',
  now: () => number = () => performance.now(),
): Promise<DenoiserSource> {
  let loading = DENOISERS.get(weights);
  if (!loading) {
    loading = (async () => {
      const started = now();
      const { WEIGHTS, initUNetFromBuffer } = await import('./render-denoise');
      const response = await fetch(WEIGHTS[weights]);
      if (!response.ok) throw new Error(`the denoiser's weights: HTTP ${response.status}`);
      const file = await response.arrayBuffer();
      return {
        weights,
        bytes: file.byteLength,
        seconds: (now() - started) / 1000,
        // The library asks for its weights by address; they are here already. Each network gets
        // a copy, so that none can change what the next one reads.
        initUNetFromURL: (_url: string, backend: { device: GPUDevice }, options: object) =>
          initUNetFromBuffer(file.slice(0), backend, options),
      };
    })();
    DENOISERS.set(weights, loading);
    loading.catch(() => DENOISERS.delete(weights));
  }
  return loading;
}

export class Trace {
  private readonly tracer: WebGPUPathTracer;
  private denoiser: OIDNDenoiser | undefined;
  private frame = 0;
  private stopped = false;
  /** "Stop" was pressed: no more samples; the image there is is denoised, then it ends. */
  private finishing = false;
  /** The checkpoints still ahead, and the one the tracer stopped at (its target), to be handled. */
  private ahead: number[] = [];
  private pending: number | undefined;
  /** The samples of the last checkpoint handled, and when the tracer was seen at its target. */
  private handled = 0;
  private reachedAt: number | undefined;
  private last: TraceProgress = { stage: 'building', samples: 0, average: 0, done: false };
  /** Set when the browser took the graphics device away: nothing more can be traced with it. */
  lost: string | undefined;
  /** Set when the denoiser failed: the trace started over without it. */
  denoiseError: string | undefined;
  /**
   * Told of each checkpoint while its image is on the canvas: `capture` and `captureRaw` then
   * give that image. The last one is the sample target, or the samples there were at "Stop".
   */
  onCheckpoint: ((checkpoint: TraceCheckpoint) => void) | undefined;

  private constructor(
    private readonly renderer: WebGPURenderer,
    readonly settings: TraceSettings,
    private readonly now: () => number,
  ) {
    const tracer = new WebGPUPathTracer(renderer);
    if (settings.megakernel)
      (tracer as unknown as { useMegakernel?(on: boolean): void }).useMegakernel?.(true);
    renderer.onDeviceLost = (info) => {
      this.lost = info.message || info.reason || 'no reason given';
      this.stop();
    };
    tracer.maxSamples = settings.samples;
    tracer.maxBounces = settings.bounces;
    // A still: no low-resolution preview while the camera moves, and no fade from one.
    tracer.dynamicLowRes = false;
    tracer.renderDelay = 0;
    tracer.fadeDuration = 0;
    // The image has the size asked for, whatever the canvas is laid out as.
    tracer.synchronizeRenderSize = false;
    tracer.setSize(settings.width, settings.height);
    // The kernels compile without holding the page.
    tracer.asyncCompile = true;
    tracer.addEventListener('progress', (event) => {
      // A pass of the denoiser: the samples are those of the target, reached.
      if (event.stage === 'denoising' || this.denoiser?.running) {
        this.reachedAt ??= this.now();
        this.last = { ...this.last, stage: 'denoising' };
        if (event.stage === 'denoising') return;
      }
      const samples: SampleCounts | undefined = event.samples;
      const min = Math.floor(samples?.min ?? 0);
      if (event.stage === 'rendering' && min >= tracer.maxSamples) this.reachedAt ??= this.now();
      this.last = {
        stage: this.denoiser?.running ? 'denoising' : event.stage,
        samples: min,
        average: samples?.avg ?? 0,
        done: this.last.done,
      };
    });
    // Every pixel has the target's samples and, with a denoiser, the denoised image is drawn.
    tracer.addEventListener('complete', () => {
      this.pending = tracer.maxSamples;
    });
    this.tracer = tracer;
    if (settings.denoiser) {
      const denoiser = new OIDNDenoiser({
        initUNetFromURL: settings.denoiser.initUNetFromURL,
        // The library asks for this address; `loadDenoiser` has the file already.
        auxWeightsUrl: settings.denoiser.weights,
      });
      denoiser.addEventListener('error', ({ error }) => this.dropDenoiser(error));
      // The tracer now also gathers the albedo and the normals the network is guided by.
      tracer.setDenoiser(denoiser);
      this.denoiser = denoiser;
    }
  }

  /** A tracer on `canvas`; rejects when the browser gives no WebGPU device. */
  static async create(
    canvas: HTMLCanvasElement,
    settings: TraceSettings,
    now: () => number = () => performance.now(),
  ): Promise<Trace> {
    const renderer = new WebGPURenderer({
      canvas,
      // The backdrop is behind the canvas, not in the image (D23).
      alpha: true,
      antialias: false,
      // The tracer fits the work of a frame to the time the GPU took for the last one.
      trackTimestamp: true,
    });
    await renderer.init();
    renderer.setPixelRatio(1);
    renderer.setSize(settings.width, settings.height, false);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = NeutralToneMapping;
    return new Trace(renderer, settings, now);
  }

  get progress(): TraceProgress {
    return this.last;
  }

  /** Whether the images at the checkpoints are denoised. */
  get denoised(): boolean {
    return this.denoiser !== undefined;
  }

  /** The denoiser failed (its network did not load or run): the still starts over without it. */
  private dropDenoiser(error: unknown) {
    this.denoiseError = error instanceof Error ? error.message : String(error);
    const failed = this.denoiser;
    this.denoiser = undefined;
    // Dropping it starts the samples over: the tracer stops gathering what the network needs.
    this.tracer.setDenoiser(null);
    failed?.dispose();
    if (this.finishing) return this.stop();
    this.ahead = checkpoints(this.settings.samples);
    this.tracer.maxSamples = this.ahead.shift()!;
    this.pending = undefined;
    this.reachedAt = undefined;
    this.handled = 0;
    this.last = { stage: 'rendering', samples: 0, average: 0, done: false };
  }

  /** Starts over with a scene and a camera: builds its acceleration structure, then adds samples. */
  start(built: TraceScene, camera: PerspectiveCamera) {
    this.renderer.toneMappingExposure = built.exposure;
    this.last = { stage: 'building', samples: 0, average: 0, done: false };
    this.ahead = checkpoints(this.settings.samples);
    this.tracer.maxSamples = this.ahead.shift()!;
    this.pending = undefined;
    this.reachedAt = undefined;
    this.handled = 0;
    this.finishing = false;
    this.tracer.pause = false;
    this.tracer.setScene(built.scene, camera);
    this.stopped = false;
    cancelAnimationFrame(this.frame);
    const step = () => {
      if (this.stopped) return;
      this.tracer.renderSample();
      if (this.pending !== undefined) this.checkpoint(this.pending);
      if (!this.stopped) this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  /** The tracer is at its target: tells of the image, then goes on to the next checkpoint or ends. */
  private checkpoint(samples: number) {
    this.pending = undefined;
    const ready = this.now();
    const reached = Math.min(this.reachedAt ?? ready, ready);
    this.reachedAt = undefined;
    this.handled = samples;
    this.onCheckpoint?.({ samples, denoised: this.denoiser !== undefined, reached, ready });
    const next = this.ahead.shift();
    if (this.finishing || next === undefined) {
      this.last = {
        ...this.last,
        stage: 'rendering',
        samples: Math.max(this.last.samples, samples),
        done: !this.finishing,
      };
      return this.stop();
    }
    this.last = { ...this.last, stage: 'rendering' };
    // The samples made are kept; the denoised image is dropped and made again at the next one.
    this.tracer.maxSamples = next;
  }

  /** The samples every pixel has, read from the GPU now. */
  async samples(): Promise<{ min: number; average: number }> {
    const counts = await this.tracer.getSampleCountsAsync();
    return { min: Math.floor(counts.min), average: counts.avg };
  }

  /**
   * Draws the image as it is into a 2D canvas, over what that canvas holds (the backdrop): at a
   * checkpoint or once ended, the denoised one. A WebGPU canvas keeps its image only until the
   * frame ends, so it is presented and copied in one task. While the tracer runs, presenting is
   * one more round of samples.
   */
  capture(target: CanvasRenderingContext2D) {
    this.tracer.renderSample();
    target.drawImage(this.renderer.domElement, 0, 0);
  }

  /**
   * The image without the denoiser, at a checkpoint: for the measuring page's comparison. The
   * library has no switch for it: its denoiser is set aside for one presentation (pinned
   * version, D101). With the target reached it adds no samples, and its `complete` is not fired again.
   */
  captureRaw(target: CanvasRenderingContext2D) {
    const tracer = this.tracer as unknown as { _denoiser: OIDNDenoiser | null };
    const denoiser = tracer._denoiser;
    tracer._denoiser = null;
    try {
      this.capture(target);
    } finally {
      tracer._denoiser = denoiser;
    }
  }

  /**
   * "Stop": no more samples, and the image there is is denoised (a last checkpoint). Without a
   * denoiser, before the first sample, or just at a checkpoint, it stops at once.
   */
  finish() {
    if (this.stopped || this.finishing || this.lost !== undefined) return;
    // At a checkpoint (its pass runs, or it is about to be told of) that one is the last.
    const atTarget = this.pending !== undefined || this.denoiser?.running === true;
    if (
      !this.denoiser ||
      this.last.samples < 1 ||
      (!atTarget && this.handled === this.last.samples)
    )
      return this.stop();
    this.finishing = true;
    this.tracer.pause = true;
    // Otherwise the target comes down to the samples every pixel has, and the library denoises them.
    if (!atTarget) this.tracer.maxSamples = this.last.samples;
  }

  /** Adds no more samples and runs nothing more; the image stays. */
  stop() {
    this.stopped = true;
    this.finishing = false;
    // Paused, the tracer still presents its image (`capture`) and adds nothing to it.
    this.tracer.pause = true;
    cancelAnimationFrame(this.frame);
  }

  /** Whether samples are being added. */
  get running(): boolean {
    return !this.stopped && !this.finishing && !this.last.done && this.lost === undefined;
  }

  /** Whether "Stop" was pressed and the image there is is being denoised. */
  get settling(): boolean {
    return this.finishing && !this.stopped && this.lost === undefined;
  }

  dispose() {
    this.stop();
    this.tracer.dispose();
    this.renderer.dispose();
  }
}
