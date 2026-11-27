/**
 * The HUD's measuring page as markdown (docs/design/hud.md §10.2): what the owner's phone says about effects over
 * the 3D view while orbiting and walking, and whether the Sakuga clock sleeps at rest (C1). Pure, so it is tested.
 */

export type RunKind = 'orbit' | 'walk';

export interface Run {
  kind: RunKind;
  /** Effects fired over the view during the run. */
  effects: boolean;
  /** When each 3D frame was drawn during the run (ms). */
  frameTimes: readonly number[];
  /** Frames the Sakuga clock ran during the run, and the time it spent in them (ms). */
  sakugaFrames: number;
  sakugaMs: number;
  /** Effects actually drawn: 0 when calm (reduced motion or Effects off) refused them. */
  fired: number;
}

export interface Rest {
  /** Where in the measurement. */
  when: string;
  /** Frames the Sakuga clock ran in `seconds` with nothing used. */
  frames: number;
  seconds: number;
  /** A frame was still asked for at the end. */
  running: boolean;
  /** The effects before it had not ended after the longest wait (a very slow device): it says nothing about C1. */
  unsettled?: boolean;
}

export interface HudContext {
  commit: string | undefined;
  time: Date;
  device: string;
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  reducedMotion: boolean;
  /** SakugaFX.calm: no effects (reduced motion, or the app's Effects switch). */
  calm: boolean;
  /** sakuga-hud ran: its elements are Sakuga's, not the plain fallback. */
  hud: boolean;
  /** The core is there at all (the loading bar's script ran). */
  core: boolean;
}

/** Times from one frame to the next. */
export const intervals = (times: readonly number[]) =>
  times.slice(1).map((time, i) => time - times[i]!);

/** The p-th share of the sorted values (nearest rank); undefined for none. */
export function percentile(values: readonly number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

const ms = (value: number | undefined) => (value === undefined ? '–' : `${value.toFixed(1)} ms`);
const yes = (value: boolean) => (value ? 'yes' : 'no');
const NAMES: Record<RunKind, string> = {
  orbit: 'Orbit (the camera turns by script)',
  walk: 'Walk (forward and turning, first person)',
};

export function hudReport(
  context: HudContext,
  runs: readonly Run[],
  rests: readonly Rest[],
): string {
  const lines = [
    '### HUD: measurement on this device (`/?hud=measure`)',
    '',
    '| | |',
    '| --- | --- |',
    `| Commit | ${context.commit ? context.commit.slice(0, 7) : 'unknown'} |`,
    `| Time | ${context.time.toISOString()} |`,
    `| Device | ${context.device} |`,
    `| Screen | ${context.viewport.width}×${context.viewport.height} css px, ×${context.devicePixelRatio} |`,
    `| Reduced motion | ${yes(context.reducedMotion)} |`,
    `| Effects | ${context.calm ? 'off (calm): the runs with effects drew none' : 'on'} |`,
    `| Sakuga | ${!context.core ? 'not loaded' : context.hud ? 'core and sakuga-hud loaded' : 'core only: sakuga-hud did not load'} |`,
    '',
    '| Run | Effects over the view | 3D frames | 3D frame time p50 | p95 | Sakuga frames | Sakuga time per frame |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const run of runs) {
    const gaps = intervals(run.frameTimes);
    lines.push(
      `| ${NAMES[run.kind]} | ${run.effects ? `${run.fired} fired (a burst, a puff and a word, 4 a second)` : 'none'} | ${
        run.frameTimes.length
      } | ${ms(percentile(gaps, 0.5))} | ${ms(percentile(gaps, 0.95))} | ${run.sakugaFrames} | ${
        run.sakugaFrames ? ms(run.sakugaMs / run.sakugaFrames) : '–'
      } |`,
    );
  }
  lines.push(
    '',
    '| Asleep at rest (C1) | Sakuga frames | Still asking for a frame |',
    '| --- | --- | --- |',
  );
  for (const rest of rests)
    lines.push(
      `| ${rest.when} (${rest.seconds} s, nothing used${
        rest.unsettled ? '; the effects had not ended after 30 s' : ''
      }) | ${rest.frames} | ${yes(rest.running)} |`,
    );
  const counted = rests.filter((rest) => !rest.unsettled);
  const asleep = counted.length > 0 && counted.every((rest) => rest.frames === 0 && !rest.running);
  const verdict =
    counted.length === 0
      ? 'could not be checked: the effects never ended'
      : asleep
        ? 'holds: no Sakuga frame at rest'
        : 'does not hold: the Sakuga clock ran at rest';
  lines.push(
    '',
    `Each run is 5 s. 3D frame time: from one drawn frame of the view to the next. C1 ${verdict}.`,
  );
  return lines.join('\n');
}
