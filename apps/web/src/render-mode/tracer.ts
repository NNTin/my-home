import { NeutralToneMapping, WebGPURenderer, type PerspectiveCamera } from 'three/webgpu';
import { WebGPUPathTracer, type SampleCounts } from 'three-gpu-pathtracer/webgpu';
import type { TraceScene } from './traceScene';

/**
 * The path tracer of render mode (docs/design/realistic-render.md §9): `three-gpu-pathtracer`'s
 * WebGPU tracer on a WebGPU renderer of its own, in a canvas of its own. It shares no GPU object
 * with the viewer, whose WebGL context stays as it is underneath.
 */

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
}

/** The sample target of §9. */
export const SAMPLE_TARGET = 256;
/**
 * Scatterings per path. Daylight in a room is the light of its second to fourth bounce; beyond
 * eight a path adds less than the noise that is left at the sample target.
 */
export const BOUNCES = 8;

export type TraceStage = 'building' | 'compiling' | 'rendering';

/** What the tracer says while it works: the stage, and once it renders the samples of the image. */
export interface TraceProgress {
  stage: TraceStage;
  /** The fewest samples any pixel has: what "done" is measured by. */
  samples: number;
  average: number;
  done: boolean;
}

export class Trace {
  private readonly tracer: WebGPUPathTracer;
  private frame = 0;
  private stopped = false;
  private last: TraceProgress = { stage: 'building', samples: 0, average: 0, done: false };
  /** Set when the browser took the graphics device away: nothing more can be traced with it. */
  lost: string | undefined;

  private constructor(
    private readonly renderer: WebGPURenderer,
    readonly settings: TraceSettings,
    private readonly onProgress: (progress: TraceProgress) => void,
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
      if (event.stage === 'denoising') return;
      const samples: SampleCounts | undefined = event.samples;
      this.report({
        stage: event.stage,
        samples: Math.floor(samples?.min ?? 0),
        average: samples?.avg ?? 0,
        done: this.last.done,
      });
    });
    tracer.addEventListener('complete', () => this.report({ ...this.last, done: true }));
    this.tracer = tracer;
  }

  /** A tracer on `canvas`; rejects when the browser gives no WebGPU device. */
  static async create(
    canvas: HTMLCanvasElement,
    settings: TraceSettings,
    onProgress: (progress: TraceProgress) => void,
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
    return new Trace(renderer, settings, onProgress);
  }

  private report(progress: TraceProgress) {
    this.last = progress;
    this.onProgress(progress);
  }

  get progress(): TraceProgress {
    return this.last;
  }

  /** Starts over with a scene and a camera: builds its acceleration structure, then adds samples. */
  start(built: TraceScene, camera: PerspectiveCamera) {
    this.renderer.toneMappingExposure = built.exposure;
    this.last = { stage: 'building', samples: 0, average: 0, done: false };
    this.tracer.pause = false;
    this.tracer.setScene(built.scene, camera);
    this.stopped = false;
    cancelAnimationFrame(this.frame);
    const step = () => {
      if (this.stopped) return;
      this.tracer.renderSample();
      if (!this.last.done) this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  /** The samples every pixel has, read from the GPU now. */
  async samples(): Promise<{ min: number; average: number }> {
    const counts = await this.tracer.getSampleCountsAsync();
    return { min: Math.floor(counts.min), average: counts.avg };
  }

  /**
   * Draws the image as it is into a 2D canvas, over what that canvas holds (the backdrop). A
   * WebGPU canvas keeps its image only until the frame ends, so it is presented and copied in
   * one task. While the tracer runs, presenting is one more round of samples.
   */
  capture(target: CanvasRenderingContext2D) {
    this.tracer.renderSample();
    target.drawImage(this.renderer.domElement, 0, 0);
  }

  /** Adds no more samples; the image stays. */
  stop() {
    this.stopped = true;
    // Paused, the tracer still presents its image (`capture`) and adds nothing to it.
    this.tracer.pause = true;
    cancelAnimationFrame(this.frame);
  }

  /** Whether samples are being added. */
  get running(): boolean {
    return !this.stopped && !this.last.done && this.lost === undefined;
  }

  dispose() {
    this.stop();
    this.tracer.dispose();
    this.renderer.dispose();
  }
}
