import type { PerspectiveCamera } from 'three';
import { BOUNCES, SAMPLE_TARGET, Trace, type TraceProgress } from './tracer';
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
};

export class Still {
  private trace: Trace | undefined;
  private built: TraceScene | undefined;
  private size = '';
  private request = 0;
  private queue: Promise<void> = Promise.resolve();
  private startedAt = 0;
  private endedAt: number | undefined;
  private failed: string | undefined;
  private disposed = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Starts the still of a view, over whatever was being traced. */
  show(inputs: TraceInputs, view: { camera: PerspectiveCamera; width: number; height: number }) {
    const request = ++this.request;
    this.trace?.stop();
    // One at a time: a view changed twice in a row starts once, with the last of them.
    this.queue = this.queue
      .then(() => (request === this.request ? this.begin(inputs, view) : undefined))
      .catch((error: unknown) => {
        this.failed = error instanceof Error ? error.message : String(error);
      });
  }

  private async begin(
    inputs: TraceInputs,
    view: { camera: PerspectiveCamera; width: number; height: number },
  ) {
    const meshes = traceMeshes(inputs);
    await whenTexturesArrived(inputs.materials, traceFinishes(meshes));
    const size = stillSize(view.width, view.height);
    const key = `${size.width}x${size.height}`;
    if (!this.disposed && (!this.trace || this.size !== key || this.trace.lost !== undefined)) {
      this.trace?.dispose();
      this.trace = undefined;
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      this.host.replaceChildren(canvas);
      this.trace = await Trace.create(
        canvas,
        { ...size, samples: SAMPLE_TARGET, bounces: BOUNCES },
        () => undefined,
      );
      this.size = key;
    }
    const built = buildTraceScene(inputs, meshes);
    if (this.disposed || !this.trace) {
      built.dispose();
      this.trace?.dispose();
      this.trace = undefined;
      return;
    }
    // Until its first sample the canvas shows nothing: the viewer's frame is seen through it.
    this.host.style.background = '';
    this.trace.start(built, view.camera);
    this.built?.dispose();
    this.built = built;
    this.startedAt = this.now();
    this.endedAt = undefined;
    this.failed = undefined;
  }

  /** Where the still is now; also lays the backdrop behind the image once there is one. */
  progress(): StillProgress {
    const { trace, built } = this;
    if (this.failed !== undefined) return { ...NO_PROGRESS, running: false, failed: this.failed };
    if (!trace || !built) return NO_PROGRESS;
    if (trace.lost !== undefined)
      return { ...trace.progress, seconds: 0, running: false, failed: trace.lost };
    const { progress, running } = trace;
    if (progress.samples >= 1) this.host.style.background = built.backdrop;
    if (!running) this.endedAt ??= this.now();
    return {
      ...progress,
      seconds: ((this.endedAt ?? this.now()) - this.startedAt) / 1000,
      running,
    };
  }

  /** "Stop": no more samples; the image stays. */
  stop() {
    this.request += 1;
    this.trace?.stop();
  }

  /** The still as it is, over its backdrop, as a PNG. */
  async image(): Promise<Blob> {
    const { trace, built } = this;
    if (!trace || !built) throw new Error('nothing is traced yet');
    const canvas = document.createElement('canvas');
    canvas.width = trace.settings.width;
    canvas.height = trace.settings.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2D canvas');
    paintBackdrop(context, built.backdropColors);
    trace.capture(context);
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
