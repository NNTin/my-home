import type { PerspectiveCamera } from 'three';
import {
  BOUNCES,
  loadDenoiser,
  SAMPLE_TARGET,
  Trace,
  type DenoiserSource,
  type TraceCheckpoint,
  type TraceProgress,
} from './tracer';
import {
  buildTraceScene,
  paintBackdrop,
  traceFinishes,
  traceMeshes,
  whenTexturesArrived,
  type TraceInputs,
  type TraceScene,
} from './traceScene';

/**
 * One still of render mode (docs/design/realistic-render.md §9): the tracer in a canvas of its
 * own over the viewer, given the scene of the frame it replaces. `show` starts it, and starts it
 * over when the view changes; the tracer and its canvas are kept as long as the size is.
 *
 * What is on screen is the denoised still (D114): until the first checkpoint the tracer's canvas
 * shows the raw samples as they come; from then on a 2D canvas over it holds the denoised image
 * of the last checkpoint, and of the samples there were at "Stop". "Save image" saves that one.
 */

/** The widest a still is traced, in pixels: the size the gate measured (§9). */
export const STILL_MAX_WIDTH = 1920;

/** The pixels of a still for a view of this size in CSS pixels: one a pixel, at most 1920 wide. */
export function stillSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, STILL_MAX_WIDTH / Math.max(1, width));
  return {
    width: Math.max(16, Math.floor(width * scale)),
    height: Math.max(16, Math.floor(height * scale)),
  };
}

/** What the page shows of a still. */
export interface StillProgress extends TraceProgress {
  /** Seconds since this still was started; it stands still once the still is done or stopped. */
  seconds: number;
  running: boolean;
  /** "Stop" was pressed, and the image there is is being denoised. */
  settling: boolean;
  /** The samples of the denoised image on screen; 0 while none is. */
  denoised: number;
  /** Why the still is not denoised, when it is not. */
  undenoised?: string;
  /** Set when the still cannot be made (no device, or the browser took it away). */
  failed?: string;
}

export const NO_PROGRESS: StillProgress = {
  stage: 'building',
  samples: 0,
  average: 0,
  done: false,
  seconds: 0,
  running: true,
  settling: false,
  denoised: 0,
};

/** What a still is made with; a test gives it stand-ins for the tracer and the texture files. */
export interface StillParts {
  meshes: typeof traceMeshes;
  texturesArrived: typeof whenTexturesArrived;
  build: typeof buildTraceScene;
  createTrace: typeof Trace.create;
  loadDenoiser: () => Promise<DenoiserSource>;
}

const PARTS: StillParts = {
  meshes: traceMeshes,
  texturesArrived: whenTexturesArrived,
  build: buildTraceScene,
  createTrace: (canvas, settings) => Trace.create(canvas, settings),
  // Render mode's network: the small weights (D114).
  loadDenoiser: () => loadDenoiser('small'),
};

export class Still {
  private trace: Trace | undefined;
  private built: TraceScene | undefined;
  private size = '';
  private request = 0;
  /**
   * The views shown, counted, and the one whose scene the tracer has. Only an image of the last
   * view shown is the still: one of an earlier view stays on the tracer when "Stop" comes before
   * the new view started, and must neither show nor be saved under the new view's name.
   */
  private shown = 0;
  private traced = 0;
  private queue: Promise<void> = Promise.resolve();
  private startedAt = 0;
  private endedAt: number | undefined;
  private failed: string | undefined;
  /** "Stop" was pressed and nothing was started since: whatever is being prepared is dropped. */
  private halted = false;
  private disposed = false;
  /** The denoised image of the view shown, over the tracer's canvas, and its samples (0: none). */
  private readonly shownImage = document.createElement('canvas');
  private denoised = 0;
  /** Why there is no denoiser, if it did not load. */
  private undenoised: string | undefined;

  constructor(
    private readonly host: HTMLElement,
    private readonly now: () => number = () => performance.now(),
    private readonly parts: StillParts = PARTS,
  ) {}

  /** Starts the still of a view, over whatever was being traced. */
  show(inputs: TraceInputs, view: { camera: PerspectiveCamera; width: number; height: number }) {
    const request = ++this.request;
    const shown = ++this.shown;
    this.halted = false;
    this.trace?.stop();
    // The image of the view before is not this one's: hidden until this one's first sample.
    this.host.style.visibility = 'hidden';
    this.showDenoised(false);
    // One at a time: a view changed twice in a row starts once, with the last of them.
    this.queue = this.queue
      .then(() => (request === this.request ? this.begin(request, shown, inputs, view) : undefined))
      .catch((error: unknown) => {
        this.failed = error instanceof Error ? error.message : String(error);
      });
  }

  /**
   * Prepares and starts the still of `request`. The textures and a new tracer take time: after
   * each wait the request may be an old one ("Stop", another view, the mode closed), and then
   * nothing is started. A tracer made meanwhile is kept for the next still of its size.
   */
  private async begin(
    request: number,
    shown: number,
    inputs: TraceInputs,
    view: { camera: PerspectiveCamera; width: number; height: number },
  ) {
    const { parts } = this;
    const stale = () => this.disposed || request !== this.request;
    const meshes = parts.meshes(inputs);
    const drop = () => {
      for (const mesh of meshes) mesh.geometry.dispose();
    };
    // The denoiser's network downloads while the textures do; a still without it is the raw one.
    this.undenoised = undefined;
    const denoiser = parts.loadDenoiser().catch((error: unknown) => {
      this.undenoised = error instanceof Error ? error.message : String(error);
      return undefined;
    });
    await parts.texturesArrived(inputs.materials, traceFinishes(meshes));
    if (stale()) return drop();
    const size = stillSize(view.width, view.height);
    const key = `${size.width}x${size.height}`;
    if (!this.trace || this.size !== key || this.trace.lost !== undefined) {
      this.trace?.dispose();
      this.trace = undefined;
      this.built?.dispose();
      this.built = undefined;
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      this.shownImage.width = size.width;
      this.shownImage.height = size.height;
      this.host.replaceChildren(canvas, this.shownImage);
      const made = await parts.createTrace(canvas, {
        ...size,
        samples: SAMPLE_TARGET,
        bounces: BOUNCES,
        denoiser: await denoiser,
      });
      if (this.disposed) {
        made.dispose();
        return drop();
      }
      this.trace = made;
      this.size = key;
      if (stale()) return drop();
    }
    const built = parts.build(inputs, meshes);
    // Until its first sample the canvas shows nothing: the viewer's frame is seen through it.
    this.host.style.background = '';
    const trace = this.trace;
    trace.onCheckpoint = (checkpoint) => this.checkpoint(trace, shown, checkpoint);
    trace.start(built, view.camera);
    this.built?.dispose();
    this.built = built;
    this.traced = shown;
    this.startedAt = this.now();
    this.endedAt = undefined;
    this.failed = undefined;
  }

  /** A checkpoint of the view shown: its denoised image goes on screen, over the raw samples. */
  private checkpoint(trace: Trace, shown: number, checkpoint: TraceCheckpoint) {
    if (shown !== this.shown || trace !== this.trace || !checkpoint.denoised) return;
    const context = this.shownImage.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, this.shownImage.width, this.shownImage.height);
    trace.capture(context);
    this.denoised = checkpoint.samples;
    this.showDenoised(true);
  }

  /** Shows the denoised image over the tracer's canvas, or the tracer's canvas alone. */
  private showDenoised(on: boolean) {
    if (!on) this.denoised = 0;
    this.shownImage.style.visibility = on ? '' : 'hidden';
    const traced = this.host.firstElementChild;
    if (traced instanceof HTMLElement && traced !== this.shownImage)
      traced.style.visibility = on ? 'hidden' : '';
  }

  /** Where the still is now; also lays the backdrop behind the image once there is one. */
  progress(): StillProgress {
    const { trace, built } = this;
    if (this.failed !== undefined) return { ...NO_PROGRESS, running: false, failed: this.failed };
    // Stopped while it was being prepared: nothing runs, and nothing will. What the tracer has
    // then is the view before, which is not shown.
    if (!trace || !built || this.traced !== this.shown)
      return this.halted ? { ...NO_PROGRESS, running: false } : NO_PROGRESS;
    if (trace.lost !== undefined)
      return { ...NO_PROGRESS, ...trace.progress, seconds: 0, running: false, failed: trace.lost };
    const { progress, running, settling } = trace;
    const undenoised = trace.denoised
      ? undefined
      : (trace.denoiseError ?? this.undenoised ?? 'no denoiser');
    if (progress.samples >= 1) {
      this.host.style.background = built.backdrop;
      this.host.style.visibility = '';
    }
    if (!running) this.endedAt ??= this.now();
    return {
      ...progress,
      seconds: ((this.endedAt ?? this.now()) - this.startedAt) / 1000,
      running,
      settling,
      denoised: this.denoised,
      ...(undenoised !== undefined && { undenoised }),
    };
  }

  /** "Stop": no more samples; the image there is is denoised and stays. */
  stop() {
    this.request += 1;
    this.halted = true;
    if (this.trace && this.traced === this.shown) this.trace.finish();
    else this.trace?.stop();
  }

  /** Whether there is an image to save: a first sample of the view shown is on the canvas. */
  get hasImage(): boolean {
    return (
      this.trace !== undefined &&
      this.built !== undefined &&
      this.traced === this.shown &&
      this.trace.progress.samples >= 1
    );
  }

  /** The still as it is on screen (the denoised image once there is one), over its backdrop, as a PNG. */
  async image(): Promise<Blob> {
    const { trace, built } = this;
    if (!trace || !built || !this.hasImage) throw new Error('nothing is traced yet');
    const canvas = document.createElement('canvas');
    canvas.width = trace.settings.width;
    canvas.height = trace.settings.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2D canvas');
    paintBackdrop(context, built.backdropColors);
    if (this.denoised > 0) context.drawImage(this.shownImage, 0, 0);
    else trace.capture(context);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('the canvas gave no image');
    return blob;
  }

  dispose() {
    this.disposed = true;
    this.request += 1;
    this.trace?.dispose();
    this.trace = undefined;
    this.built?.dispose();
    this.built = undefined;
    this.host.replaceChildren();
  }
}
