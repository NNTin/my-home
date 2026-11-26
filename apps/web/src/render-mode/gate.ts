import type { HomeScene } from '../builder/buildHome';
import type { PlacementDraw } from '../builder/drawList';
import type { Visibility } from '../builder/visibility';
import type { FinishMaterials } from '../finishes/materials';
import type { EmitterSource } from '../lighting/lamps';
import { backdropColors, rigFor } from '../lighting/rig';
import {
  defaultView,
  sectionPlane,
  VIEW_BACKDROP,
  VIEW_KINDS,
  viewFrame,
  viewRig,
  viewVisibility,
  type NamedView,
} from '../views/named';
import {
  checkpoints,
  imageDifference,
  type Checkpoint,
  type ChunkSize,
  type GateContext,
  type ViewMeasurement,
} from './measure';
import { BOUNCES, SAMPLE_TARGET, Trace, type TraceSettings } from './tracer';
import {
  buildTraceScene,
  frameCamera,
  paintBackdrop,
  traceFinishes,
  traceMeshes,
  whenTexturesArrived,
  type TraceInputs,
} from './traceScene';

/**
 * Runs the decision gate (`measure.ts`): traces the three fixed views one after the other, each
 * to the sample target or the time limit, and keeps the image at every checkpoint.
 */

/** What the gate measures with, from the address: `?render=measure&size=1280x720&samples=128`. */
export interface GateSettings extends TraceSettings {
  /** Seconds after which a view is given up. */
  limit: number;
  /** The fixed views measured, in their order: `&views=eye,section` measures two. All without it. */
  views: readonly string[];
}

const whole = (value: string | null, fallback: number, min: number, max: number) => {
  const n = value === null ? NaN : Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function gateSettings(search: string): GateSettings {
  const params = new URLSearchParams(search);
  const size = /^(\d+)x(\d+)$/.exec(params.get('size') ?? '');
  return {
    // The size of a desktop's view, whatever the window is: the numbers can be compared.
    width: whole(size?.[1] ?? null, 1920, 16, 3840),
    height: whole(size?.[2] ?? null, 1080, 16, 2160),
    samples: whole(params.get('samples'), SAMPLE_TARGET, 1, 4096),
    bounces: whole(params.get('bounces'), BOUNCES, 1, 32),
    limit: whole(params.get('limit'), 180, 5, 3600),
    megakernel: params.get('kernel') === 'mega',
    views: (params.get('views') ?? '')
      .split(',')
      .map((kind) => kind.trim())
      .filter((kind) => (VIEW_KINDS as readonly string[]).includes(kind)),
  };
}

export interface GateInputs {
  scene: HomeScene;
  /** The furniture the viewer draws for a visibility. */
  furnitureFor(visibility: Visibility): readonly (PlacementDraw & EmitterSource)[];
  planColours: boolean;
  materials: FinishMaterials;
}

/** The three fixed views (§11.3), as they open without parameters; `only` keeps some of them. */
export const gateViews = (scene: HomeScene, only: readonly string[] = []): NamedView[] =>
  VIEW_KINDS.filter((kind) => only.length === 0 || only.includes(kind)).flatMap(
    (kind) => defaultView(scene, kind) ?? [],
  );

/** What the tracer is given for a named view. */
export function viewInputs(inputs: GateInputs, view: NamedView): TraceInputs {
  const visibility = viewVisibility(inputs.scene, view);
  return {
    scene: inputs.scene,
    placements: inputs.furnitureFor(visibility),
    visibility,
    planColours: inputs.planColours,
    rig: { ...rigFor(viewRig(view)), backdrop: VIEW_BACKDROP },
    eye: view.kind === 'eye',
    plane: view.kind === 'section' ? sectionPlane(inputs.scene, view) : undefined,
    ground: true,
    materials: inputs.materials,
  };
}

/** What the page shows while the gate runs. */
export interface GateStatus {
  view: string;
  text: string;
  /** The backdrop of the view being traced, as a CSS background. */
  backdrop: string;
}

/** A finished view: its numbers and its still as a PNG. */
export interface GateResult {
  measurement: ViewMeasurement;
  image?: Blob;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => performance.now() / 1000;

async function measureView(
  trace: Trace,
  settings: GateSettings,
  inputs: GateInputs,
  view: NamedView,
  onStatus: (status: GateStatus) => void,
  signal: AbortSignal,
): Promise<GateResult> {
  const traced = viewInputs(inputs, view);
  const { top } = backdropColors(traced.rig.backdrop, traced.eye);
  const say = (text: string, backdrop = top) => onStatus({ view: view.kind, text, backdrop });
  say('Loading textures');
  const meshes = traceMeshes(traced);
  await whenTexturesArrived(traced.materials, traceFinishes(meshes));
  // The textures are the viewer's, there or not before the gate: not part of the measurement.
  const started = now();
  const built = buildTraceScene(traced, meshes);
  const camera = frameCamera(viewFrame(inputs.scene, view), settings.width / settings.height);
  say('Building the scene', built.backdrop);
  // A frame, so that the page shows the line above before the build holds it.
  await pause(30);
  const measurement: ViewMeasurement = {
    view: view.kind,
    meshes: built.meshes,
    triangles: built.triangles,
    lamps: built.lamps,
    buildSeconds: 0,
    firstSampleSeconds: undefined,
    checkpoints: [],
    samples: 0,
    seconds: 0,
    timedOut: false,
  };
  // The image is kept in a canvas of its own, over the backdrop it is shown on.
  const kept = document.createElement('canvas');
  kept.width = settings.width;
  kept.height = settings.height;
  const context = kept.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('no 2D canvas');
  const capture = () => {
    context.fillStyle = top;
    context.fillRect(0, 0, kept.width, kept.height);
    trace.capture(context);
    return context.getImageData(0, 0, kept.width, kept.height).data;
  };
  try {
    trace.start(built, camera);
    const traceStart = now();
    measurement.buildSeconds = traceStart - started;
    const wanted = checkpoints(settings.samples);
    let before: Uint8ClampedArray | undefined;
    for (;;) {
      await pause(200);
      if (signal.aborted) throw new DOMException('stopped', 'AbortError');
      if (trace.lost !== undefined)
        throw new Error(`the browser took the graphics device away (${trace.lost})`);
      const elapsed = now() - traceStart;
      const { stage } = trace.progress;
      const samples = stage === 'rendering' ? (await trace.samples()).min : 0;
      if (samples >= 1 && measurement.firstSampleSeconds === undefined)
        measurement.firstSampleSeconds = elapsed;
      measurement.samples = samples;
      measurement.seconds = elapsed;
      say(
        stage === 'rendering'
          ? `${samples} of ${settings.samples} samples, ${elapsed.toFixed(0)} s`
          : stage === 'compiling'
            ? `Compiling the tracer, ${elapsed.toFixed(0)} s`
            : `Building the scene, ${elapsed.toFixed(0)} s`,
        built.backdrop,
      );
      while (wanted.length > 0 && samples >= wanted[0]!) {
        wanted.shift();
        // Only the last checkpoint passed is an image of its own. On a fast card two fall into
        // one look at the samples: the image is then compared with one of a quarter of its
        // samples, which is the stricter test.
        if (wanted.length > 0 && samples >= wanted[0]!) continue;
        const image = capture();
        const point: Checkpoint = { samples, seconds: now() - traceStart };
        if (before) Object.assign(point, imageDifference(before, image));
        measurement.checkpoints.push(point);
        before = image;
      }
      if (wanted.length === 0) break;
      if (elapsed > settings.limit) {
        measurement.timedOut = true;
        break;
      }
    }
    trace.stop();
    // The still as it is saved: over the backdrop as the view shows it, a gradient at eye level.
    paintBackdrop(context, built.backdropColors);
    trace.capture(context);
    const image = await new Promise<Blob | null>((resolve) => kept.toBlob(resolve, 'image/png'));
    return { measurement, ...(image && { image }) };
  } finally {
    trace.stop();
    built.dispose();
  }
}

/**
 * Measures every fixed view, each with a tracer and a canvas of its own in `host`: a view whose
 * tracer fails (a lost device) does not take the next one with it. `on.result` is told of each
 * view as it finishes; a view that fails is a result with its error.
 */
export async function runGate(
  host: HTMLElement,
  settings: GateSettings,
  inputs: GateInputs,
  on: { status(status: GateStatus): void; result(result: GateResult): void },
  signal: AbortSignal,
): Promise<void> {
  for (const view of gateViews(inputs.scene, settings.views)) {
    if (signal.aborted) return;
    const canvas = document.createElement('canvas');
    canvas.width = settings.width;
    canvas.height = settings.height;
    host.replaceChildren(canvas);
    let trace: Trace | undefined;
    try {
      trace = await Trace.create(canvas, settings, () => undefined);
      on.result(await measureView(trace, settings, inputs, view, on.status, signal));
    } catch (error) {
      if (signal.aborted) return;
      on.result({
        measurement: {
          view: view.kind,
          meshes: 0,
          triangles: 0,
          lamps: 0,
          buildSeconds: 0,
          firstSampleSeconds: undefined,
          checkpoints: [],
          samples: 0,
          seconds: 0,
          timedOut: false,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    } finally {
      trace?.dispose();
    }
  }
  host.replaceChildren();
}

/** The names a WebGPU adapter and WebGL give the graphics card. */
export async function graphicsNames(): Promise<Pick<GateContext, 'adapter' | 'graphics'>> {
  let adapter = 'none';
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    const found = (await gpu?.requestAdapter()) as
      { info?: Record<string, unknown>; isFallbackAdapter?: boolean } | null | undefined;
    if (found) {
      const info = found.info ?? {};
      const names = ['vendor', 'architecture', 'device', 'description']
        .map((key) => info[key])
        .filter((value) => typeof value === 'string' && value !== '');
      const software = info.isFallbackAdapter === true || found.isFallbackAdapter === true;
      adapter = `${names.join(', ') || 'unnamed'}${software ? ' (software)' : ''}`;
    }
  } catch {
    // The adapter stays "none".
  }
  let graphics = 'unknown';
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2') ?? probe.getContext('webgl');
  if (gl) {
    const names = gl.getExtension('WEBGL_debug_renderer_info');
    graphics = String(gl.getParameter(names ? names.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return { adapter, graphics };
}

/** The bytes `body` gives when gzipped by the browser (zlib's default level, 6). */
async function gzippedBytes(body: ReadableStream<Uint8Array>): Promise<number> {
  // The DOM types give the compressor a wider input than a fetched body: it takes this one.
  const gzip = new CompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>;
  return (await new Response(body.pipeThrough(gzip)).arrayBuffer()).byteLength;
}

/**
 * The lazy chunk's size (`ChunkSize`): what the browser downloaded and unpacked, from its resource
 * timings, and its files gzipped here again, from the cache, to compare with the budget.
 * Undefined if the browser does not say.
 */
export async function chunkSize(): Promise<ChunkSize | undefined> {
  const entries = performance
    .getEntriesByType('resource')
    .filter((entry): entry is PerformanceResourceTiming =>
      /\/render-path-[\w-]+\.(js|css)$/.test(new URL(entry.name).pathname),
    );
  const served = entries.reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0);
  if (served === 0) return undefined;
  const decoded = entries.reduce((sum, entry) => sum + (entry.decodedBodySize || 0), 0);
  // Newer browsers name the server's compression; older ones leave it out.
  const encodings = [
    ...new Set(
      entries.map((entry) => (entry as { contentEncoding?: string }).contentEncoding || ''),
    ),
  ].filter((name) => name !== '');
  let gzip: number | undefined;
  try {
    const sizes = await Promise.all(
      entries.map(async (entry) => {
        const response = await fetch(entry.name, { cache: 'force-cache' });
        if (!response.ok || !response.body) throw new Error(String(response.status));
        return gzippedBytes(response.body);
      }),
    );
    gzip = sizes.reduce((sum, size) => sum + size, 0);
  } catch {
    // Without the files again there is no number to compare with the budget.
  }
  return { served, decoded, encoding: encodings.join(', ') || undefined, gzip };
}

/** The commit of the running release, as the api's public liveness answer has it. */
export async function releaseCommit(signal: AbortSignal): Promise<string | undefined> {
  try {
    const response = await fetch('/api/health/live', { signal });
    const live: unknown = await response.json();
    const commit = (live as { commit?: unknown } | null)?.commit;
    return typeof commit === 'string' ? commit : undefined;
  } catch {
    return undefined;
  }
}
