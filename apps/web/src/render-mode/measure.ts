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
 */

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

/** The image as it was kept at a sample count. */
export interface Checkpoint {
  /** The fewest samples any pixel had. */
  samples: number;
  /** Since the tracer was given the scene: building, compiling and tracing. */
  seconds: number;
  /** Against the checkpoint before: undefined for the first. */
  mean?: number;
  changed?: number;
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
  error?: string;
}

/**
 * The first checkpoint whose image is clean: the next one, with twice the samples, changed
 * fewer than `CLEAN_SHARE` of its pixels. Undefined when none is, or when there is no next one
 * to judge by.
 */
export function cleanAt(points: readonly Checkpoint[]): Checkpoint | undefined {
  for (let i = 0; i + 1 < points.length; i++) {
    const next = points[i + 1]!;
    if (next.changed !== undefined && next.changed < CLEAN_SHARE) return points[i]!;
  }
  return undefined;
}

/** A view passes the gate when it has a clean still within `GATE_SECONDS`. */
export function passes(measurement: ViewMeasurement): boolean {
  const clean = cleanAt(measurement.checkpoints);
  return clean !== undefined && clean.seconds <= GATE_SECONDS;
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
  /** The tracer's backend: the library's default (wavefront) or its megakernel. */
  kernel: string;
  /** The size of the lazy chunk as downloaded, if the browser says. */
  chunkBytes: number | undefined;
}

const seconds = (value: number | undefined) => (value === undefined ? 'n/a' : value.toFixed(1));
const percent = (value: number | undefined) =>
  value === undefined ? '' : `${(value * 100).toFixed(2)} %`;

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
    `| Sample target, bounces, backend | ${context.samples}, ${context.bounces}, ${context.kernel} |`,
    `| \`render-path\` chunk, as downloaded | ${
      context.chunkBytes ? `${(context.chunkBytes / 1000).toFixed(1)} kB` : 'not reported'
    } |`,
    '',
    '| View | Clean still | Sample target | First sample | Scene | Gate (60 s) |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const m of views) {
    const clean = cleanAt(m.checkpoints);
    const target = m.error
      ? `failed: ${m.error}`
      : `${m.samples} samples in ${seconds(m.seconds)} s${m.timedOut ? ' (time limit)' : ''}`;
    lines.push(
      `| ${m.view} | ${
        clean ? `${seconds(clean.seconds)} s at ${clean.samples} samples` : 'not reached'
      } | ${target} | ${seconds(m.firstSampleSeconds)} s | ${m.meshes} meshes, ${Math.round(
        m.triangles,
      )} triangles, ${m.lamps} lamps, built in ${seconds(m.buildSeconds)} s | ${
        passes(m) ? 'pass' : 'fail'
      } |`,
    );
  }
  lines.push(
    '',
    `Clean: fewer than ${CLEAN_SHARE * 100} % of the pixels change by more than ${CLEAN_LEVELS} of 255 levels when the samples are doubled.`,
    '',
    '| View | Samples | Seconds | Pixels changed since the checkpoint before | Mean change (levels) |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const m of views)
    for (const point of m.checkpoints)
      lines.push(
        `| ${m.view} | ${point.samples} | ${seconds(point.seconds)} | ${percent(point.changed)} | ${
          point.mean === undefined ? '' : point.mean.toFixed(2)
        } |`,
      );
  return `${lines.join('\n')}\n`;
}
