import { POOL_SIZE, SHADOW_LAMPS } from '../lighting/lamps';
import type { PerfData } from './governor';

/**
 * The `?perf=1` readout as text (docs/design/realistic-render.md §10.3): the rows the panel
 * shows, and the report its "Copy" button puts on the clipboard, a markdown table with the
 * context a reader needs to compare two runs and the budgets of §10.1 next to what was measured.
 * Pure: the page hands in what it knows.
 */

/** The budgets of §10.1 a frame can be held against, for a phone and for a desktop. */
export const BUDGETS = {
  /** Draw calls of a moving frame: the first view of the home, and the whole house. */
  drawCalls: { default: { phone: 250, desktop: 350 }, whole: { phone: 350, desktop: 500 } },
  trianglesWhole: 150_000,
  trianglesPerPiece: 5_000,
  /** The sun, and the lamps of the pool that cast a shadow. */
  shadowLights: { phone: 1 + SHADOW_LAMPS.phone, desktop: 1 + SHADOW_LAMPS.desktop },
  litLamps: POOL_SIZE,
  medianFrameMs: { phone: 33, desktop: 17 },
  /** The refined frame of `auto`; a desktop is beautiful all the time. */
  refinedFrameMs: { phone: 300, desktop: undefined },
} as const;

export interface PerfRow {
  name: string;
  value: string;
  /** The budget of this device class the value is held against, when there is one. */
  budget?: string;
}

const ms = (value: number | undefined) => (value === undefined ? '–' : `${value.toFixed(1)} ms`);
const count = (value: number) => value.toLocaleString('en-US');

/** The rows of the readout, in the panel's order. */
export function perfRows(data: PerfData, phone: boolean): PerfRow[] {
  const device = phone ? 'phone' : 'desktop';
  const calls = BUDGETS.drawCalls;
  const refined = BUDGETS.refinedFrameMs[device];
  return [
    { name: 'Setting', value: data.setting },
    // The viewer protects itself on a slow device (§3.4): what it behaves as since.
    { name: 'Stepped down', value: data.steppedDown ? `yes, to ${data.steppedDown}` : 'no' },
    {
      name: 'Tier',
      value: data.beautifulReady ? data.tier : `${data.tier} (beautiful not loaded)`,
    },
    { name: 'View', value: data.state === 'settled' ? 'resting' : 'moving' },
    {
      name: 'Draw calls, last frame',
      value: String(data.drawCalls),
      budget: `≤ ${calls.default[device]} first view, ≤ ${calls.whole[device]} whole house`,
    },
    // Whatever the state: 0 only when nothing at all was drawn in the last 3 seconds.
    {
      name: 'Draw calls, last 3 s',
      value: `${data.recentDrawCalls} (${data.recentFrames} frames)`,
      budget: '0 while resting',
    },
    {
      name: 'Triangles',
      value: String(data.triangles),
      budget: `≤ ${count(BUDGETS.trianglesWhole)} whole house`,
    },
    { name: 'Textures', value: String(data.textures) },
    {
      name: 'Texture files',
      value: `${data.textureFiles}${data.textureFailures ? `, ${data.textureFailures} failed` : ''}`,
    },
    {
      name: 'Lit lamps',
      value: `${data.litLamps} (${data.lampChanges} reassigned)`,
      budget: `≤ ${BUDGETS.litLamps[device]}`,
    },
    {
      name: 'Lights with shadows',
      value: String(data.shadowLights),
      budget: `≤ ${BUDGETS.shadowLights[device]}`,
    },
    {
      name: 'Shader programs',
      value: `${data.programs} (${data.compiles} compiled)`,
      budget: 'none compiled by a tier switch',
    },
    {
      name: 'Frame, median',
      value: ms(data.medianFrameMs),
      budget: `≤ ${BUDGETS.medianFrameMs[device]} ms`,
    },
    { name: 'Frame, 95th percentile', value: ms(data.p95FrameMs) },
    {
      name: 'Refined frame',
      value: `${ms(data.refinedFrameMs)} (${data.refinedFrames} drawn)`,
      budget: refined === undefined ? 'n/a' : `≤ ${refined} ms`,
    },
    { name: 'Frames', value: String(data.frames) },
  ];
}

/** What the page knows besides the frame: enough to tell two runs apart. */
export interface PerfContext {
  /** The app's commit as the api reports it; undefined when it does not say. */
  commit: string | undefined;
  /** The view or mode: orbit or walk, and which level. */
  view: string;
  phone: boolean;
  /** The window, in CSS pixels, and the device's pixel ratio. */
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  /** The canvas' drawing buffer, in pixels; undefined when there is none. */
  canvas: { width: number; height: number } | undefined;
  userAgent: string;
  time: Date;
}

const version = (found: RegExpMatchArray | null, parts = 1) =>
  found?.[1]?.split(/[._]/).slice(0, parts).join('.');

/** A user agent's browser and system, each with its version where it says one. */
export function shortUserAgent(userAgent: string): string {
  const find = (pattern: RegExp, parts?: number) => version(userAgent.match(pattern), parts);
  // The order matters: every browser names the ones it descends from.
  const browsers: [string, RegExp][] = [
    ['Edge', /Edg(?:e|A|iOS)?\/([\d.]+)/],
    ['Samsung Internet', /SamsungBrowser\/([\d.]+)/],
    ['Opera', /OPR\/([\d.]+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/],
    ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/],
    ['Safari', /Version\/([\d.]+).*Safari\//],
  ];
  const systems: [string, RegExp, number][] = [
    ['Android', /Android ([\d.]+)/, 1],
    ['iOS', /(?:iPhone|CPU) OS ([\d_]+)/, 2],
    ['Windows', /Windows NT ([\d.]+)/, 2],
    ['macOS', /Mac OS X ([\d_.]+)/, 2],
    ['ChromeOS', /CrOS \S+ ([\d.]+)/, 1],
  ];
  const named = <T extends [string, RegExp, ...number[]]>(known: T[]) => {
    for (const [name, pattern, parts] of known) {
      if (pattern.test(userAgent)) return [name, find(pattern, parts)].filter(Boolean).join(' ');
    }
    return undefined;
  };
  const browser = named(browsers);
  const system = named(systems) ?? (/Linux/.test(userAgent) ? 'Linux' : undefined);
  const short = [browser, system].filter(Boolean).join(', ');
  // Nothing recognised: the start of the string is better than nothing.
  return short || userAgent.slice(0, 60) || 'unknown';
}

/** A table cell: one line, and no `|` that would end it. */
const cell = (text: string) => text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();

const size = (s: { width: number; height: number }) => `${s.width}×${s.height}`;

/**
 * The report: one markdown table, so that a paste into a GitHub comment renders right away.
 * The context comes first, then every row of the readout with its budget.
 */
export function perfReport(data: PerfData, context: PerfContext): string {
  const device = context.phone ? 'phone' : 'desktop';
  const about: PerfRow[] = [
    { name: 'Commit', value: context.commit ? context.commit.slice(0, 7) : 'unknown' },
    { name: 'Time', value: context.time.toISOString().replace(/\.\d+Z$/, 'Z') },
    { name: 'Device class', value: device },
    { name: 'Browser', value: shortUserAgent(context.userAgent) },
    {
      name: 'Viewport',
      value: `${size(context.viewport)}, device pixel ratio ${Number(context.devicePixelRatio.toFixed(2))}`,
    },
    { name: 'Canvas', value: context.canvas ? `${size(context.canvas)} px` : 'unknown' },
    { name: 'Mode', value: context.view },
  ];
  const lines = [
    `| \`?perf=1\` | Measured | Budget (${device}) |`,
    '| --- | --- | --- |',
    ...[...about, ...perfRows(data, context.phone)].map(
      // An empty cell is one space wide, like the others' padding.
      (row) =>
        `| ${[row.name, row.value, row.budget ?? ''].map(cell).join(' | ')} |`.replace(
          / {2,}/g,
          ' ',
        ),
    ),
  ];
  return `${lines.join('\n')}\n`;
}

/** What the view shows, as the scene knows it. */
export interface PerfViewSource {
  levels: readonly { id: string; name: string; index: number }[];
  /** The cutaway: levels above this index are hidden; one above the top level shows the roof. */
  maxLevelIndex: number;
  /** Walking: first person or the overview, and the level the figure is on (none outdoors). */
  walk?: { view: 'first' | 'third'; levelId: string | undefined };
  /** Looking from where a photo was taken. */
  viewpoint?: boolean;
}

/** The view or mode in words: orbit or walk, and which level. */
export function perfView({ levels, maxLevelIndex, walk, viewpoint }: PerfViewSource): string {
  const named = (level: { name: string } | undefined) => (level ? `level "${level.name}"` : '');
  if (walk) {
    const on = levels.find((l) => l.id === walk.levelId);
    const mode = walk.view === 'first' ? 'walk, first person' : 'walk, overview';
    return `${mode}, ${on ? named(on) : 'outdoors'}`;
  }
  if (viewpoint) return 'photo viewpoint';
  const top = levels.find((l) => l.index === maxLevelIndex);
  return top ? `orbit, cutaway at ${named(top)}` : 'orbit, whole house with roof';
}
