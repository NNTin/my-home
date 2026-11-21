import type { Quality } from './setting';

/**
 * The frame governor (docs/design/realistic-render.md §4.3): it knows whether the view is moving,
 * picks the tier of each frame from the quality setting, says when the view has settled, and
 * records frame times for the `?perf` readout. Pure: the clock and the timers are handed in.
 */

/** What one frame contains (§3.1). Render mode is not a tier of this loop. */
export type Tier = 'fast' | 'beautiful';

/** `moving`: frames are being drawn. `settled`: the last frame is on screen and nothing asks for one. */
export type FrameState = 'moving' | 'settled';

/** How long after the last frame, with nothing moving, the view counts as settled (§3.3). */
export const SETTLE_MS = 200;

/** The window of `recentDrawCalls`: long enough to read, short enough to wait for. */
export const RECENT_MS = 3000;

/** Frame times kept for the median and the 95th percentile. */
const SAMPLES = 240;

/** What the renderer reports of the frame it just drew. */
export interface FrameReport {
  drawCalls: number;
  triangles: number;
  /** Shader programs the renderer holds, and how many it has compiled since the page loaded. */
  programs: number;
  compiles: number;
  /** This frame compiled a program itself, instead of finding it compiled ahead. */
  compiled: boolean;
  textures: number;
  /** Lights that cast a shadow, and lamps of the pool that are lit. */
  shadowLights: number;
  litLamps: number;
  /** Pool lights that changed their emitter since the page loaded (§6.4). */
  lampChanges: number;
}

/** The `?perf` data (§10.3). Times are milliseconds. */
export interface PerfData extends FrameReport {
  setting: Quality;
  tier: Tier;
  state: FrameState;
  /** Frames drawn since the page loaded. */
  frames: number;
  /**
   * Draw calls and frames of the last `RECENT_MS`, whatever the state: both are 0 only when
   * nothing at all was drawn for that long, which is what "resting" must mean.
   */
  recentDrawCalls: number;
  recentFrames: number;
  /** Time from one moving frame to the next; undefined before two were drawn. */
  medianFrameMs: number | undefined;
  p95FrameMs: number | undefined;
  /** The refined frame of `auto` (#111). */
  refinedFrameMs: number | undefined;
}

export interface GovernorClock {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const realClock: GovernorClock = {
  now: () => performance.now(),
  setTimeout: (run, ms) => window.setTimeout(run, ms),
  clearTimeout: (id) => window.clearTimeout(id as number),
};

const percentile = (sorted: number[], p: number) =>
  sorted.length === 0
    ? undefined
    : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

export class FrameGovernor {
  private setting: Quality = 'fast';
  private frameState: FrameState = 'moving';
  private readonly sources = new Set<string>();
  private timer: unknown;
  private lastFrameAt: number | undefined;
  private lastCounted = false;
  private readonly times: number[] = [];
  private frames = 0;
  /** When each recent frame was drawn, and its draw calls. */
  private recent: { at: number; drawCalls: number }[] = [];
  private last: FrameReport = {
    drawCalls: 0,
    triangles: 0,
    programs: 0,
    compiles: 0,
    compiled: false,
    textures: 0,
    shadowLights: 0,
    litLamps: 0,
    lampChanges: 0,
  };
  /** Told when the state or the tier changes: the scene marks the canvas with them. */
  onChange: ((state: FrameState, tier: Tier) => void) | undefined;
  /** Whether a frame is waiting to be drawn; a settle is put off while one is. */
  framePending: () => boolean = () => false;
  /** Told when the last source stopped moving the view. */
  private onStill: (() => void) | undefined;

  /** Connects the frame loop; returns the action that disconnects it. */
  attach(loop: {
    onChange(state: FrameState, tier: Tier): void;
    framePending(): boolean;
    onStill?(): void;
  }) {
    this.onChange = loop.onChange;
    this.framePending = loop.framePending;
    this.onStill = loop.onStill;
    return () => {
      this.onChange = undefined;
      this.framePending = () => false;
      this.onStill = undefined;
    };
  }

  constructor(private readonly clock: GovernorClock = realClock) {}

  setSetting(setting: Quality) {
    if (setting === this.setting) return;
    this.setting = setting;
    this.onChange?.(this.frameState, this.tier());
  }

  /**
   * The tier of the next frame. Every setting draws the fast tier until the beautiful tier
   * exists (#111); from then on `beautiful` draws it always and `auto` once the view is still.
   */
  tier(): Tier {
    return 'fast';
  }

  get state(): FrameState {
    return this.frameState;
  }

  /** Whether something moves the view: the orbit controls, a furniture drag, the walk figure. */
  get moving(): boolean {
    return this.sources.size > 0;
  }

  /** `source` starts or stops moving the view (`orbit`, `drag`, `walk`). */
  setMoving(source: string, moving: boolean) {
    const was = this.moving;
    if (moving) this.sources.add(source);
    else this.sources.delete(source);
    if (moving) this.unsettle();
    else this.armSettle();
    if (was && !this.moving) this.onStill?.();
  }

  /** A frame is about to be drawn. */
  frameStarted() {
    this.unsettle();
  }

  /** A frame was drawn. A frame that compiled a shader does not count as a frame time (§4.5). */
  frameDrawn(report: FrameReport) {
    const now = this.clock.now();
    if (this.lastFrameAt !== undefined && this.lastCounted && !report.compiled) {
      this.times.push(now - this.lastFrameAt);
      if (this.times.length > SAMPLES) this.times.shift();
    }
    this.lastFrameAt = now;
    this.lastCounted = true;
    this.frames += 1;
    this.recent = this.recent.filter((f) => now - f.at < RECENT_MS);
    this.recent.push({ at: now, drawCalls: report.drawCalls });
    this.last = report;
    this.armSettle();
  }

  private unsettle() {
    this.clock.clearTimeout(this.timer);
    this.timer = undefined;
    if (this.frameState === 'moving') return;
    this.frameState = 'moving';
    this.onChange?.('moving', this.tier());
  }

  private armSettle() {
    this.clock.clearTimeout(this.timer);
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined;
      // Something still moves or a frame is on its way: the frame it draws arms the timer again.
      if (this.moving) return;
      if (this.framePending()) return this.armSettle();
      this.frameState = 'settled';
      // The next frame starts a new run: the pause before it is not a frame time.
      this.lastCounted = false;
      this.onChange?.('settled', this.tier());
    }, SETTLE_MS);
  }

  perf(): PerfData {
    const sorted = [...this.times].sort((a, b) => a - b);
    const now = this.clock.now();
    const recent = this.recent.filter((f) => now - f.at < RECENT_MS);
    return {
      ...this.last,
      setting: this.setting,
      tier: this.tier(),
      state: this.frameState,
      frames: this.frames,
      recentDrawCalls: recent.reduce((sum, f) => sum + f.drawCalls, 0),
      recentFrames: recent.length,
      medianFrameMs: percentile(sorted, 0.5),
      p95FrameMs: percentile(sorted, 0.95),
      refinedFrameMs: undefined,
    };
  }

  dispose() {
    this.clock.clearTimeout(this.timer);
    this.onChange = undefined;
  }
}
