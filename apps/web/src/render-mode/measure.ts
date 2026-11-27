/**
 * The decision gate of render mode (docs/design/realistic-render.md §9): how long the path
 * tracer takes to a clean still of each of the three fixed views, measured on the machine the
 * page is opened on. This file is the arithmetic and the report; `Gate.tsx` runs the tracer.
 *
 * "Clean" has to be a number, so it is defined here. The image is kept at 16, 32, 64, ... samples
 * a pixel. Twice the samples halve the noise that is left, so how much the image still changes
 * from one of these to the next says how noisy it was. An image is clean when fewer than
 * `CLEAN_SHARE` of its pixels change by more than `CLEAN_LEVELS` of 255 levels with twice the
 * samples: grain of about one and a half levels, which the eye does not find in a still.
 *
 * With the denoiser (D114) the rule is applied to the denoised image: the still on screen. The
 * raw image is judged by the same rule beside it, for comparison.
 */
import budget from '../../bundle-budget.json';

/** A pixel that changes by more than this many of 255 levels, in any channel, has changed. */
export const CLEAN_LEVELS = 4;
/** The share of changed pixels below which an image is clean. */
export const CLEAN_SHARE = 0.01;
/** What the gate allows a view: seconds to a clean still (§9). */
export const GATE_SECONDS = 60;

/** The sample counts at which the image is kept: the target and its halves down to 16. */
export function checkpoints(target: number): number[] {
  const list: number[] = [];
  for (let n = target; n >= 16; n = Math.floor(n / 2)) list.unshift(n);
  return list.length > 0 ? list : [target];
}

/** How two images of the same size differ, in levels of 255 over their colour channels. */
export function imageDifference(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): { mean: number; changed: number } {
  const pixels = Math.min(a.length, b.length) / 4;
  if (pixels === 0) return { mean: 0, changed: 0 };
  let sum = 0;
  let changed = 0;
  for (let i = 0; i < pixels * 4; i += 4) {
    const [r, g, bl] = [
      Math.abs(a[i]! - b[i]!),
      Math.abs(a[i + 1]! - b[i + 1]!),
      Math.abs(a[i + 2]! - b[i + 2]!),
    ];
    sum += r + g + bl;
    if (Math.max(r, g, bl) > CLEAN_LEVELS) changed += 1;
  }
  return { mean: sum / (pixels * 3), changed: changed / pixels };
}

/** How an image differs from the one at the checkpoint before (`imageDifference`). */
export interface ImageChange {
  mean: number;
  changed: number;
}

/** The image as it was kept at a sample count. */
export interface Checkpoint {
  /** The samples every pixel had. */
  samples: number;
  /** Since the tracer was given the scene until every pixel had them: building, compiling, tracing. */
  seconds: number;
  /** The raw image against the checkpoint before: undefined for the first. */
  raw?: ImageChange;
  /** With the denoiser: when its image was ready, and how it differs from the one before. */
  denoised?: { seconds: number; change?: ImageChange };
}

export interface ViewMeasurement {
  view: string;
  meshes: number;
  triangles: number;
  lamps: number;
  /** Making the scene and its acceleration structure, before the first sample. */
  buildSeconds: number;
  /** Until the first sample was on screen: the kernels' compile. */
  firstSampleSeconds: number | undefined;
  checkpoints: Checkpoint[];
  /** The samples reached when the measurement ended, and after how long. */
  samples: number;
  seconds: number;
  /** The time limit ended the measurement before the sample target. */
  timedOut: boolean;
  /** Whether the checkpoints were denoised: the gate then judges the denoised still. */
  denoised: boolean;
  /** Why the denoiser stopped during this view, if it did (the view went on without it). */
  denoiseError?: string;
  error?: string;
}

/** Which image of a checkpoint is judged: the denoised still, or the tracer's raw one. */
export type Judged = 'denoised' | 'raw';

/** The change of one image of a checkpoint. */
const changeOf = (point: Checkpoint, judged: Judged): ImageChange | undefined =>
  judged === 'raw' ? point.raw : point.denoised?.change;

/** When one image of a checkpoint was there. */
const secondsOf = (point: Checkpoint, judged: Judged): number | undefined =>
  judged === 'raw' ? point.seconds : point.denoised?.seconds;

/**
 * The first checkpoint whose image is clean: the next one, with twice the samples, changed
 * fewer than `CLEAN_SHARE` of its pixels. Undefined when none is, or when there is no next one
 * to judge by.
 */
export function cleanAt(
  points: readonly Checkpoint[],
  judged: Judged = 'denoised',
): { samples: number; seconds: number } | undefined {
  for (let i = 0; i + 1 < points.length; i++) {
    const change = changeOf(points[i + 1]!, judged);
    const seconds = secondsOf(points[i]!, judged);
    if (change !== undefined && seconds !== undefined && change.changed < CLEAN_SHARE)
      return { samples: points[i]!.samples, seconds };
  }
  return undefined;
}

/** The image a view is judged by: the denoised one when it was denoised (D114). */
export const judgedImage = (m: ViewMeasurement): Judged => (m.denoised ? 'denoised' : 'raw');

/** A view passes the gate when it has a clean still within `GATE_SECONDS`. */
export function passes(measurement: ViewMeasurement): boolean {
  const clean = cleanAt(measurement.checkpoints, judgedImage(measurement));
  return clean !== undefined && clean.seconds <= GATE_SECONDS;
}

/** The seconds the denoiser took a still, on average over the checkpoints. */
export function denoiseSeconds(points: readonly Checkpoint[]): number | undefined {
  const passes = points.flatMap((p) => (p.denoised ? [p.denoised.seconds - p.seconds] : []));
  return passes.length === 0 ? undefined : passes.reduce((a, b) => a + b, 0) / passes.length;
}

/** What tells two measurements apart: the machine and what was asked for. */
export interface GateContext {
  commit: string | undefined;
  time: Date;
  browser: string;
  /** The WebGPU adapter as the browser names it. */
  adapter: string;
  /** The graphics card as WebGL names it: usually the model. */
  graphics: string;
  width: number;
  height: number;
  samples: number;
  bounces: number;
  /** Seconds after which a view was given up. */
  limit: number;
  /** The tracer's backend: the library's default (wavefront) or its megakernel. */
  kernel: string;
  /** The denoiser: its weights, their size and download, or why there was none. */
  denoiser: string;
  /** The lazy chunks' sizes, in the three ways each can be counted (`ChunkSize`). */
  chunks: { name: string; size: ChunkSize | undefined }[];
}

/**
 * A lazy chunk's size. The budget (D104, `bundle-budget.json`) is the built files gzipped at
 * level 9, as CI measures them; what a browser downloads is what the server sent, whose
 * compression is the server's (nginx gzips at level 6 since #185).
 */
export interface ChunkSize {
  /** The bytes that came over the network, as the server compressed them. */
  served: number;
  /** How the server compressed them (`gzip`, `br`, ...), if the browser says. */
  encoding?: string | undefined;
  /** The files as they run: uncompressed. */
  decoded: number;
  /** The files gzipped in this browser (level 6): about a kilobyte over CI's level 9. */
  gzip?: number | undefined;
}

const seconds = (value: number | undefined) => (value === undefined ? 'n/a' : value.toFixed(1));
const percent = (value: number | undefined) =>
  value === undefined ? '' : `${(value * 100).toFixed(2)} %`;

const kB = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB`;

type LazyBudget = { maxGzipBytes?: number; files?: string[] };

/** The budget of a lazy chunk in `bundle-budget.json`, in bytes (with the files it fetches, if any). */
export function chunkBudget(name: string): number | undefined {
  return (budget.lazy as Record<string, LazyBudget>)[name]?.maxGzipBytes;
}

/** A chunk's sizes as rows of the report's first table; the gzipped one is the budget's. */
function chunkRows({ name, size }: GateContext['chunks'][number]): string[] {
  if (!size) return [`| \`${name}\` chunk | not reported |`];
  const limit = chunkBudget(name);
  const files = (budget.lazy as Record<string, LazyBudget>)[name]?.files ?? [];
  const within =
    limit === undefined
      ? ''
      : ` (budget ${kB(limit)}${files.length ? `, with ${files.join(', ')} as sent` : ''})`;
  return [
    `| \`${name}\`, gzipped as CI measures it${within} | ${
      size.gzip === undefined ? 'not measured' : kB(size.gzip)
    } |`,
    `| \`${name}\`, as the server sent it | ${kB(size.served)}${
      size.encoding ? ` (${size.encoding})` : ''
    } |`,
    `| \`${name}\`, uncompressed | ${kB(size.decoded)} |`,
  ];
}

const clean = (m: ViewMeasurement, judged: Judged) => {
  const at = cleanAt(m.checkpoints, judged);
  return at ? `${seconds(at.seconds)} s at ${at.samples} samples` : 'not reached';
};

const change = (value: ImageChange | undefined) =>
  value === undefined ? ' | ' : `${percent(value.changed)} | ${value.mean.toFixed(2)}`;

/** The measurement as markdown, to paste into the issue. */
export function gateReport(context: GateContext, views: readonly ViewMeasurement[]): string {
  const lines = [
    '### Render mode: gate measurement',
    '',
    '| | |',
    '| --- | --- |',
    `| Commit | ${context.commit ? context.commit.slice(0, 7) : 'unknown'} |`,
    `| Time | ${context.time.toISOString()} |`,
    `| Browser | ${context.browser} |`,
    `| WebGPU adapter | ${context.adapter} |`,
    `| Graphics (WebGL) | ${context.graphics} |`,
    `| Image | ${context.width} x ${context.height} px |`,
    `| Sample target, bounces, backend, time limit | ${context.samples}, ${context.bounces}, ${context.kernel}, ${context.limit} s |`,
    `| Denoiser | ${context.denoiser} |`,
    ...context.chunks.flatMap(chunkRows),
    '',
    `| View | Clean still, denoised | Clean still, raw | Sample target | First sample | Denoising a still | Scene | Gate (${GATE_SECONDS} s) |`,
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const m of views) {
    const target = m.error
      ? `failed: ${m.error}`
      : `${m.samples} samples in ${seconds(m.seconds)} s${m.timedOut ? ' (time limit)' : ''}`;
    const pass = denoiseSeconds(m.checkpoints);
    lines.push(
      `| ${m.view} | ${m.denoised ? clean(m, 'denoised') : 'not denoised'} | ${clean(m, 'raw')} | ${target} | ${seconds(
        m.firstSampleSeconds,
      )} s | ${pass === undefined ? 'n/a' : `${seconds(pass)} s`}${
        m.denoiseError ? ` (stopped: ${m.denoiseError})` : ''
      } | ${m.meshes} meshes, ${Math.round(m.triangles)} triangles, ${m.lamps} lamps, built in ${seconds(
        m.buildSeconds,
      )} s | ${passes(m) ? 'pass' : 'fail'} |`,
    );
  }
  lines.push(
    '',
    `Clean: fewer than ${CLEAN_SHARE * 100} % of the pixels change by more than ${CLEAN_LEVELS} of 255 levels when the samples are doubled. ` +
      'The gate judges the denoised still when there is one. The tracer waits while the denoiser runs: a raw time includes the passes before it.',
    '',
    '| View | Samples | Seconds | Denoised after | Denoised: pixels changed | Denoised: mean change | Raw: pixels changed | Raw: mean change |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const m of views)
    for (const point of m.checkpoints)
      lines.push(
        `| ${m.view} | ${point.samples} | ${seconds(point.seconds)} | ${
          point.denoised ? seconds(point.denoised.seconds) : ''
        } | ${change(point.denoised?.change)} | ${change(point.raw)} |`,
      );
  return `${lines.join('\n')}\n`;
}
