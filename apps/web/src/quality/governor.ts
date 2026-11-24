import type { Quality } from './setting';

/**
 * The frame governor (docs/design/realistic-render.md §4.3): it knows whether the view is moving,
 * picks the tier of each frame from the quality setting, refines a still view in `auto` (§3.3),
 * steps down when the device is too slow (§3.4), says when the view has settled, and records
 * frame times for the `?perf` readout. Pure: the clock and the timers are handed in.
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

/**
 * Stepping down (§3.4). In `beautiful`, when the median of this many consecutive moving frames is
 * above `SLOW_FRAME_MS`, the viewer behaves as `auto`; in `auto`, when a refined frame takes
 * longer than `SLOW_REFINE_MS`, as `fast`. For the rest of the visit, or until a value is chosen.
 */
export const STEP_DOWN_FRAMES = 30;
export const SLOW_FRAME_MS = 40;
export const SLOW_REFINE_MS = 1000;

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
  /** Texture files of finishes that have arrived, and that failed to load (§4.4). */
  textureFiles: number;
  textureFailures: number;
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
  /** The last refined frame of `auto`: from its start until the GPU had drawn it. */
  refinedFrameMs: number | undefined;
  /** Refined frames drawn since the page loaded. */
  refinedFrames: number;
  /** Whether beautiful frames can be drawn: the lazy chunk has arrived and is compiled. */
  beautifulReady: boolean;
  /** The setting the viewer behaves as after stepping down; undefined when it has not. */
  steppedDown: Quality | undefined;
}

/** What the governor asks of the frame loop. */
export interface GovernorLoop {
  /** The state changed, or the tier of the frame on screen: the scene marks the canvas with them. */
  onChange(state: FrameState, tier: Tier): void;
  /** Whether a frame is waiting to be drawn; a settle is put off while one is. */
  framePending(): boolean;
  /** Draw a frame: the refined one, or the first of a new setting. */
  requestFrame?(): void;
  /**
   * The view is still and its refined frame is about to be asked for: whatever would move the
   * view a little more with every frame drawn (the orbit controls' damping) is ended first, or
   * the refined frame would start the next round of frames itself.
   */
  beforeRefine?(): void;
  /** The last source stopped moving the view. */
  onStill?(): void;
  /** The viewer stepped down to `to` (§3.4): one toast. */
  onStepDown?(to: Quality): void;
  /**
   * Calls `done` once the GPU has drawn everything asked of it so far. A frame is handed to the
   * GPU long before it is on screen; the view counts as settled, and a refined frame as drawn,
   * only then. Without it (tests) that is at once.
   */
  whenDrawn?(done: () => void): void;
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
  /** After a step down: the setting the viewer behaves as, for the rest of the visit. */
  private stepped: Quality | undefined;
  private ready = false;
  private frameState: FrameState = 'moving';
  private readonly sources = new Set<string>();
  private timer: unknown;
  private lastFrameAt: number | undefined;
  private lastCounted = false;
  private readonly times: number[] = [];
  /** Times of consecutive beautiful frames of one run, for stepping down. */
  private run: number[] = [];
  private frames = 0;
  /** The view is still and its one beautiful frame is asked for or being drawn (`auto`). */
  private refining = false;
  /** The frame being drawn: its tier, when it started and whether it is the refined one. */
  private drawing: { tier: Tier; at: number; refined: boolean } | undefined;
  /** Counts what ends a wait for the GPU: a new frame, or input. */
  private generation = 0;
  /** The tier of the frame on screen. */
  private shown: Tier = 'fast';
  private refinedMs: number | undefined;
  private refinedCount = 0;
  /** When each recent frame was drawn, and its draw calls. */
  private recent: { at: number; drawCalls: number }[] = [];
  private last: FrameReport = {
    drawCalls: 0,
    triangles: 0,
    programs: 0,
    compiles: 0,
    compiled: false,
    textures: 0,
    textureFiles: 0,
    textureFailures: 0,
    shadowLights: 0,
    litLamps: 0,
    lampChanges: 0,
  };
  private loop: GovernorLoop | undefined;
  private readonly clock: GovernorClock;
  private readonly stepDown: boolean;

  /**
   * `stepDown: false` turns stepping down off (`?stepdown=off`): for captures and smokes under
   * software rendering, where every frame is slow and the tier asked for must be the tier drawn.
   */
  constructor(clock: GovernorClock = realClock, options: { stepDown?: boolean } = {}) {
    this.clock = clock;
    this.stepDown = options.stepDown ?? true;
  }

  /** Connects the frame loop; returns the action that disconnects it. */
  attach(loop: GovernorLoop) {
    this.loop = loop;
    return () => {
      if (this.loop === loop) this.loop = undefined;
    };
  }

  /** The quality setting. Choosing a value clears a step down and draws a frame with it. */
  setSetting(setting: Quality) {
    if (setting === this.setting) return;
    this.setting = setting;
    this.stepped = undefined;
    this.run = [];
    this.refining = false;
    this.loop?.requestFrame?.();
  }

  /** The beautiful tier can be drawn from now on: frames stay fast until then (§4.4). */
  setBeautifulReady(ready: boolean) {
    if (ready === this.ready) return;
    this.ready = ready;
    this.refining = false;
    this.loop?.requestFrame?.();
  }

  /** The setting the viewer behaves as: the chosen one, or what it stepped down to. */
  get effective(): Quality {
    return this.stepped ?? this.setting;
  }

  /**
   * The tier of the next frame: `beautiful` draws it always, `auto` only for the one frame after
   * the view came to rest, `fast` never. Without the lazy chunk every frame is fast.
   */
  tier(): Tier {
    if (!this.ready) return 'fast';
    const effective = this.effective;
    if (effective === 'beautiful') return 'beautiful';
    return effective === 'auto' && this.refining ? 'beautiful' : 'fast';
  }

  /** The tier of the frame on screen. */
  get shownTier(): Tier {
    return this.shown;
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
    if (moving) {
      // Input ends a refine that has not been drawn yet: the next frame is a fast one.
      this.refining = false;
      this.generation += 1;
      this.unsettle();
    } else this.armSettle();
    if (was && !this.moving) this.loop?.onStill?.();
  }

  /** A frame is about to be drawn; returns its tier. */
  frameStarted(): Tier {
    this.generation += 1;
    this.unsettle();
    const tier = this.tier();
    this.drawing = { tier, at: this.clock.now(), refined: this.refining && tier === 'beautiful' };
    return tier;
  }

  /** A frame was drawn. A frame that compiled a shader does not count as a frame time (§4.5). */
  frameDrawn(report: FrameReport) {
    const now = this.clock.now();
    const drawing = this.drawing ?? { tier: this.tier(), at: now, refined: false };
    this.drawing = undefined;
    const counted = this.lastFrameAt !== undefined && this.lastCounted && !report.compiled;
    if (counted) {
      const time = now - this.lastFrameAt!;
      this.times.push(time);
      if (this.times.length > SAMPLES) this.times.shift();
      if (drawing.tier === 'beautiful' && !drawing.refined) this.run.push(time);
    }
    this.lastFrameAt = now;
    this.lastCounted = true;
    this.frames += 1;
    this.recent = this.recent.filter((f) => now - f.at < RECENT_MS);
    this.recent.push({ at: now, drawCalls: report.drawCalls });
    this.last = report;
    if (drawing.tier !== this.shown) {
      this.shown = drawing.tier;
      this.loop?.onChange(this.frameState, this.shown);
    }

    if (drawing.refined) {
      this.refining = false;
      this.refinedCount += 1;
      // Its time runs until the GPU has drawn it. Then the one beautiful frame is on screen and
      // the view has settled, unless a frame or input came meanwhile.
      return this.whenDrawn(
        () => {
          this.refinedMs = this.clock.now() - drawing.at;
          // A refined frame that compiled says nothing about the device (§4.5).
          if (!report.compiled && this.refinedMs > SLOW_REFINE_MS) this.stepTo('fast');
          this.settle();
        },
        () => this.armSettle(),
      );
    } else if (this.run.length >= STEP_DOWN_FRAMES) {
      const sorted = this.run.slice(-STEP_DOWN_FRAMES).sort((a, b) => a - b);
      if (percentile(sorted, 0.5)! > SLOW_FRAME_MS) this.stepTo('auto');
      else this.run = this.run.slice(-STEP_DOWN_FRAMES + 1);
    }
    this.armSettle();
  }

  /**
   * Runs `then` once the GPU has drawn what it was given, if no frame was started and nothing
   * began to move the view meanwhile; `otherwise` if it was overtaken while waiting.
   */
  private whenDrawn(then: () => void, otherwise?: () => void) {
    const generation = this.generation;
    const done = () => {
      if (generation === this.generation && !this.moving) then();
      else if (generation === this.generation) otherwise?.();
    };
    if (this.loop?.whenDrawn) this.loop.whenDrawn(done);
    else done();
  }

  private stepTo(to: Quality) {
    this.run = [];
    if (!this.stepDown) return;
    this.stepped = to;
    this.loop?.onStepDown?.(to);
  }

  private unsettle() {
    this.clock.clearTimeout(this.timer);
    this.timer = undefined;
    if (this.frameState === 'moving') return;
    this.frameState = 'moving';
    this.loop?.onChange('moving', this.shown);
  }

  private settle() {
    this.clock.clearTimeout(this.timer);
    this.timer = undefined;
    this.frameState = 'settled';
    // The next frame starts a new run: the pause before it is not a frame time.
    this.lastCounted = false;
    this.run = [];
    this.loop?.onChange('settled', this.shown);
  }

  private armSettle() {
    this.clock.clearTimeout(this.timer);
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined;
      // Something still moves or a frame is on its way: the frame it draws arms the timer again.
      if (this.moving) return;
      if (this.loop?.framePending()) return this.armSettle();
      // The run of moving frames ends here: the pause before the next frame is not a frame time,
      // however long the GPU still needs for the last one.
      this.lastCounted = false;
      this.run = [];
      // Refine when still (§3.3): one beautiful frame, and the view settles when it is drawn.
      if (
        this.ready &&
        this.effective === 'auto' &&
        this.shown === 'fast' &&
        this.loop?.requestFrame
      ) {
        this.refining = true;
        this.loop.beforeRefine?.();
        this.loop.requestFrame();
        return;
      }
      this.whenDrawn(() => this.settle());
    }, SETTLE_MS);
  }

  perf(): PerfData {
    const sorted = [...this.times].sort((a, b) => a - b);
    const now = this.clock.now();
    const recent = this.recent.filter((f) => now - f.at < RECENT_MS);
    return {
      ...this.last,
      setting: this.setting,
      tier: this.shown,
      state: this.frameState,
      frames: this.frames,
      recentDrawCalls: recent.reduce((sum, f) => sum + f.drawCalls, 0),
      recentFrames: recent.length,
      medianFrameMs: percentile(sorted, 0.5),
      p95FrameMs: percentile(sorted, 0.95),
      refinedFrameMs: this.refinedMs,
      refinedFrames: this.refinedCount,
      beautifulReady: this.ready,
      steppedDown: this.stepped,
    };
  }

  dispose() {
    this.clock.clearTimeout(this.timer);
    this.loop = undefined;
  }
}
