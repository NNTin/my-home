import { describe, expect, it } from 'vitest';
import {
  FrameGovernor,
  RECENT_MS,
  SETTLE_MS,
  SLOW_FRAME_MS,
  SLOW_REFINE_MS,
  STEP_DOWN_FRAMES,
  type FrameReport,
  type GovernorClock,
} from './governor';
import type { Quality } from './setting';

/** A clock that only moves when the test says so. */
function fakeClock() {
  let time = 0;
  let next = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const clock: GovernorClock = {
    now: () => time,
    setTimeout(run, ms) {
      timers.set(next, { at: time + ms, run });
      return next++;
    },
    clearTimeout: (id) => void timers.delete(id as number),
  };
  const advance = (ms: number) => {
    const end = time + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      time = due[1].at;
      due[1].run();
    }
    time = end;
  };
  return { clock, advance };
}

const report = (patch: Partial<FrameReport> = {}): FrameReport => ({
  drawCalls: 140,
  triangles: 15000,
  programs: 6,
  compiles: 6,
  compiled: false,
  textures: 0,
  textureFiles: 0,
  textureFailures: 0,
  shadowLights: 1,
  litLamps: 0,
  lampChanges: 0,
  ...patch,
});

function setup(options: { setting?: Quality; ready?: boolean; stepDown?: boolean } = {}) {
  const { clock, advance } = fakeClock();
  const governor = new FrameGovernor(clock, { stepDown: options.stepDown ?? true });
  const seen: string[] = [];
  /** What the frame loop was asked and told. */
  const loop = { pending: false, requests: 0, steps: [] as Quality[] };
  governor.attach({
    onChange: (state, tier) => seen.push(`${state}/${tier}`),
    framePending: () => loop.pending,
    requestFrame: () => loop.requests++,
    onStepDown: (to) => loop.steps.push(to),
  });
  if (options.setting) governor.setSetting(options.setting);
  if (options.ready) governor.setBeautifulReady(true);
  loop.requests = 0;
  /** The tiers of the frames drawn. */
  const tiers: string[] = [];
  /** Draws a frame `ms` after the last one; `took` is how long drawing it takes. */
  const frame = (ms: number, patch?: Partial<FrameReport>, took = 0) => {
    advance(ms);
    tiers.push(governor.frameStarted());
    advance(took);
    governor.frameDrawn(report(patch));
  };
  /** Draws the frames the governor asked for, as the frame loop would. */
  const drawRequested = (took = 0) => {
    while (loop.requests > 0) {
      loop.requests = 0;
      frame(0, undefined, took);
    }
  };
  return { governor, advance, seen, frame, loop, tiers, drawRequested };
}

describe('the frame governor', () => {
  it('tells the frame loop when the last source stopped moving the view', () => {
    const { governor } = setup();
    let still = 0;
    governor.attach({
      onChange: () => undefined,
      framePending: () => false,
      onStill: () => still++,
    });
    governor.setMoving('orbit', true);
    governor.setMoving('drag', true);
    governor.setMoving('orbit', false);
    expect(still).toBe(0);
    governor.setMoving('drag', false);
    expect(still).toBe(1);
    // Nothing was moving: nothing stopped.
    governor.setMoving('drag', false);
    expect(still).toBe(1);
  });

  it('settles 200 ms after the last frame, and not before', () => {
    const { governor, advance, seen, frame } = setup();
    expect(governor.state).toBe('moving');
    frame(0);
    advance(SETTLE_MS - 1);
    expect(governor.state).toBe('moving');
    advance(1);
    expect(governor.state).toBe('settled');
    expect(seen).toEqual(['settled/fast']);
  });

  it('a frame within the 200 ms puts the settle off; the next frame after it unsettles', () => {
    const { governor, advance, seen, frame } = setup();
    frame(0);
    frame(150);
    advance(150);
    expect(governor.state).toBe('moving');
    advance(50);
    expect(governor.state).toBe('settled');
    frame(1000);
    expect(governor.state).toBe('moving');
    advance(SETTLE_MS);
    expect(seen).toEqual(['settled/fast', 'moving/fast', 'settled/fast']);
  });

  it('does not settle while something moves the view, or while a frame is on its way', () => {
    const { governor, advance, frame, loop } = setup();
    governor.setMoving('orbit', true);
    frame(0);
    advance(1000);
    expect(governor.state).toBe('moving');
    expect(governor.moving).toBe(true);
    governor.setMoving('orbit', false);
    loop.pending = true;
    advance(SETTLE_MS);
    expect(governor.state).toBe('moving');
    loop.pending = false;
    advance(SETTLE_MS);
    expect(governor.state).toBe('settled');
  });

  it('several sources move the view independently', () => {
    const { governor, advance } = setup();
    governor.setMoving('orbit', true);
    governor.setMoving('drag', true);
    governor.setMoving('orbit', false);
    advance(SETTLE_MS);
    expect(governor.state).toBe('moving');
    governor.setMoving('drag', false);
    advance(SETTLE_MS);
    expect(governor.state).toBe('settled');
    governor.setMoving('walk', true);
    expect(governor.state).toBe('moving');
  });

  it('draws the fast tier in every setting until the beautiful chunk is ready', () => {
    const { governor, loop } = setup();
    for (const setting of ['fast', 'auto', 'beautiful'] as const) {
      governor.setSetting(setting);
      expect(governor.tier()).toBe('fast');
      expect(governor.perf()).toMatchObject({ setting, beautifulReady: false });
    }
    // A new setting draws a frame: `fast` is what the governor starts with.
    expect(loop.requests).toBe(2);
  });

  it('measures the time from one moving frame to the next', () => {
    const { governor, frame } = setup();
    frame(0);
    for (const ms of [10, 20, 30, 40]) frame(ms);
    const perf = governor.perf();
    expect(perf.frames).toBe(5);
    expect(perf.medianFrameMs).toBe(30);
    expect(perf.p95FrameMs).toBe(40);
    expect(perf.drawCalls).toBe(140);
  });

  it('the pause while the view rests is not a frame time', () => {
    const { governor, frame } = setup();
    frame(0);
    frame(16);
    frame(5000);
    frame(16);
    expect(governor.perf().medianFrameMs).toBe(16);
    expect(governor.perf().p95FrameMs).toBe(16);
  });

  it('ignores a frame that compiled a shader when it judges frame times', () => {
    const { governor, frame } = setup();
    frame(0);
    frame(16);
    frame(900, { compiled: true, compiles: 7, programs: 7 });
    frame(16, { compiles: 7, programs: 7 });
    const perf = governor.perf();
    expect(perf.p95FrameMs).toBe(16);
    expect(perf.compiles).toBe(7);
  });

  it('counts the draw calls of the last 3 seconds, whatever the state', () => {
    const { governor, advance, frame } = setup();
    frame(0);
    frame(16);
    expect(governor.perf()).toMatchObject({ recentDrawCalls: 280, recentFrames: 2 });
    // Settled, but drawn less than 3 seconds ago: still counted.
    advance(SETTLE_MS);
    expect(governor.perf()).toMatchObject({ state: 'settled', recentDrawCalls: 280 });
    advance(RECENT_MS);
    expect(governor.perf()).toMatchObject({ recentDrawCalls: 0, recentFrames: 0 });
  });

  it('a frame drawn while the view should rest shows in the number', () => {
    const { governor, advance, frame } = setup();
    frame(0);
    advance(SETTLE_MS + RECENT_MS);
    expect(governor.perf()).toMatchObject({ state: 'settled', recentDrawCalls: 0 });
    // Something asks for a frame every second with nothing moving: a stray loop.
    for (let i = 0; i < 5; i++) frame(1000);
    advance(SETTLE_MS);
    // The view counts as settled between those frames, and the number still shows them.
    expect(governor.perf()).toMatchObject({
      state: 'settled',
      recentDrawCalls: 3 * 140,
      recentFrames: 3,
    });
  });

  it('has no frame times before two frames were drawn, and no refined frame yet', () => {
    const { governor, frame } = setup();
    expect(governor.perf().medianFrameMs).toBeUndefined();
    frame(0);
    expect(governor.perf().p95FrameMs).toBeUndefined();
    expect(governor.perf().refinedFrameMs).toBeUndefined();
  });
});

describe('the tiers (docs/design/realistic-render.md §3.5)', () => {
  it('`fast` draws fast frames, moving and at rest', () => {
    const { governor, advance, frame, tiers, loop } = setup({ setting: 'fast', ready: true });
    frame(0);
    frame(16);
    advance(SETTLE_MS);
    expect(tiers).toEqual(['fast', 'fast']);
    expect(governor.state).toBe('settled');
    expect(loop.requests).toBe(0);
    expect(governor.shownTier).toBe('fast');
  });

  it('`beautiful` draws beautiful frames, moving and at rest', () => {
    const { governor, advance, frame, tiers, seen, loop } = setup({
      setting: 'beautiful',
      ready: true,
    });
    governor.setMoving('orbit', true);
    frame(0);
    frame(16);
    governor.setMoving('orbit', false);
    advance(SETTLE_MS);
    expect(tiers).toEqual(['beautiful', 'beautiful']);
    expect(seen.at(-1)).toBe('settled/beautiful');
    // Nothing more is drawn at rest.
    expect(loop.requests).toBe(0);
  });

  it('`auto` draws fast frames while moving and exactly one beautiful frame after input ends', () => {
    const { governor, advance, frame, tiers, seen, loop, drawRequested } = setup({
      setting: 'auto',
      ready: true,
    });
    governor.setMoving('orbit', true);
    for (let i = 0; i < 5; i++) frame(16);
    governor.setMoving('orbit', false);
    expect(tiers).toEqual(Array(5).fill('fast'));
    // 200 ms without a frame request: the refined frame is asked for, the view not settled yet.
    advance(SETTLE_MS - 1);
    expect(loop.requests).toBe(0);
    advance(1);
    expect(loop.requests).toBe(1);
    expect(governor.state).toBe('moving');
    drawRequested(120);
    expect(tiers.slice(5)).toEqual(['beautiful']);
    // Drawn: settled at once, with the beautiful frame on screen, and nothing more is drawn.
    expect(governor.state).toBe('settled');
    expect(seen.at(-1)).toBe('settled/beautiful');
    advance(10 * SETTLE_MS);
    expect(loop.requests).toBe(0);
    expect(governor.perf()).toMatchObject({
      refinedFrames: 1,
      refinedFrameMs: 120,
      tier: 'beautiful',
    });
  });

  it('ends what would move the view on, before it asks for the refined frame', () => {
    const { clock, advance } = fakeClock();
    const governor = new FrameGovernor(clock);
    const order: string[] = [];
    governor.attach({
      onChange: () => undefined,
      framePending: () => false,
      requestFrame: () => order.push('frame'),
      beforeRefine: () => order.push('end damping'),
    });
    governor.setSetting('auto');
    governor.setBeautifulReady(true);
    order.length = 0;
    governor.frameStarted();
    governor.frameDrawn(report());
    advance(SETTLE_MS);
    expect(order).toEqual(['end damping', 'frame']);
  });

  it('marks the canvas with the tier on screen as soon as a frame changes it', () => {
    const { governor, advance, frame, seen, drawRequested } = setup({
      setting: 'auto',
      ready: true,
    });
    frame(0);
    advance(SETTLE_MS);
    drawRequested();
    governor.setMoving('walk', true);
    frame(16);
    frame(16);
    governor.setMoving('walk', false);
    advance(SETTLE_MS);
    drawRequested();
    expect(seen).toEqual([
      'moving/beautiful',
      'settled/beautiful',
      'moving/beautiful',
      'moving/fast',
      'moving/beautiful',
      'settled/beautiful',
    ]);
  });

  it('`auto` refines again after the next input, and its frames meanwhile are fast', () => {
    const { governor, advance, frame, tiers, drawRequested } = setup({
      setting: 'auto',
      ready: true,
    });
    frame(0);
    advance(SETTLE_MS);
    drawRequested();
    expect(tiers).toEqual(['fast', 'beautiful']);
    frame(1000);
    expect(governor.state).toBe('moving');
    advance(SETTLE_MS);
    drawRequested();
    expect(tiers).toEqual(['fast', 'beautiful', 'fast', 'beautiful']);
    expect(governor.perf().refinedFrames).toBe(2);
  });

  it('`auto`: input before the refined frame is drawn makes that frame a fast one', () => {
    const { governor, advance, frame, tiers, loop, drawRequested } = setup({
      setting: 'auto',
      ready: true,
    });
    frame(0);
    advance(SETTLE_MS);
    expect(loop.requests).toBe(1);
    governor.setMoving('orbit', true);
    drawRequested();
    expect(tiers).toEqual(['fast', 'fast']);
    expect(governor.state).toBe('moving');
    governor.setMoving('orbit', false);
    advance(SETTLE_MS);
    drawRequested();
    expect(tiers.at(-1)).toBe('beautiful');
    expect(governor.state).toBe('settled');
  });

  it('the refined frame is not a moving frame time', () => {
    const { governor, advance, frame, drawRequested } = setup({ setting: 'auto', ready: true });
    frame(0);
    frame(16);
    advance(SETTLE_MS);
    drawRequested(250);
    expect(governor.perf()).toMatchObject({ medianFrameMs: 16, p95FrameMs: 16 });
  });

  it('frames turn beautiful when the chunk arrives, with a frame of their own', () => {
    const { governor, advance, frame, tiers, loop, drawRequested } = setup({
      setting: 'beautiful',
    });
    frame(0);
    advance(SETTLE_MS);
    expect(tiers).toEqual(['fast']);
    governor.setBeautifulReady(true);
    expect(loop.requests).toBe(1);
    drawRequested();
    expect(tiers).toEqual(['fast', 'beautiful']);
  });

  it('a chosen setting draws a frame in it', () => {
    const { governor, advance, frame, tiers, loop, drawRequested } = setup({
      setting: 'fast',
      ready: true,
    });
    frame(0);
    advance(SETTLE_MS);
    governor.setSetting('beautiful');
    expect(loop.requests).toBe(1);
    drawRequested();
    expect(tiers).toEqual(['fast', 'beautiful']);
  });
});

describe('waiting for the GPU', () => {
  /** A loop whose GPU reports back only when the test says so. */
  function slowGpu(setting: Quality) {
    const { clock, advance } = fakeClock();
    const governor = new FrameGovernor(clock);
    const waits: (() => void)[] = [];
    let requests = 0;
    governor.attach({
      onChange: () => undefined,
      framePending: () => false,
      requestFrame: () => requests++,
      whenDrawn: (done) => waits.push(done),
    });
    governor.setSetting(setting);
    governor.setBeautifulReady(true);
    const frame = () => {
      const tier = governor.frameStarted();
      governor.frameDrawn(report());
      return tier;
    };
    /** The GPU has drawn everything it was given. */
    const gpuDone = () => waits.splice(0).forEach((done) => done());
    return { governor, advance, frame, gpuDone, requested: () => requests };
  }

  it('the view settles only when the GPU has drawn the last frame', () => {
    const { governor, advance, frame, gpuDone } = slowGpu('beautiful');
    frame();
    advance(SETTLE_MS);
    expect(governor.state).toBe('moving');
    advance(3000);
    expect(governor.state).toBe('moving');
    gpuDone();
    expect(governor.state).toBe('settled');
  });

  it("the refined frame's time runs until the GPU has drawn it, and then the view settles", () => {
    const { governor, advance, frame, gpuDone, requested } = slowGpu('auto');
    frame();
    const before = requested();
    advance(SETTLE_MS);
    expect(requested()).toBe(before + 1);
    expect(frame()).toBe('beautiful');
    advance(700);
    expect(governor.state).toBe('moving');
    expect(governor.perf().refinedFrameMs).toBeUndefined();
    gpuDone();
    expect(governor.state).toBe('settled');
    expect(governor.perf()).toMatchObject({ refinedFrameMs: 700, refinedFrames: 1 });
  });

  it('a frame that comes while the settle waits for the GPU is not a moving frame time', () => {
    const { governor, advance, frame, gpuDone } = slowGpu('beautiful');
    frame();
    advance(16);
    frame();
    advance(SETTLE_MS + 5000);
    frame();
    advance(16);
    frame();
    gpuDone();
    expect(governor.perf()).toMatchObject({ medianFrameMs: 16, p95FrameMs: 16 });
  });

  it('a frame or input that overtakes the wait keeps the view moving', () => {
    const { governor, advance, frame, gpuDone } = slowGpu('beautiful');
    frame();
    advance(SETTLE_MS);
    frame();
    gpuDone();
    expect(governor.state).toBe('moving');
    advance(SETTLE_MS);
    governor.setMoving('orbit', true);
    gpuDone();
    expect(governor.state).toBe('moving');
    governor.setMoving('orbit', false);
    advance(SETTLE_MS);
    gpuDone();
    expect(governor.state).toBe('settled');
  });
});

describe('stepping down (§3.4)', () => {
  const slow = SLOW_FRAME_MS + 10;

  it('`beautiful` behaves as `auto` once the median of 30 consecutive moving frames is over 40 ms', () => {
    const { governor, frame, tiers, loop, advance, drawRequested } = setup({
      setting: 'beautiful',
      ready: true,
    });
    governor.setMoving('orbit', true);
    frame(0);
    for (let i = 0; i < STEP_DOWN_FRAMES - 1; i++) frame(slow);
    expect(loop.steps).toEqual([]);
    frame(slow);
    expect(loop.steps).toEqual(['auto']);
    expect(governor.perf()).toMatchObject({ setting: 'beautiful', steppedDown: 'auto' });
    // From now on: fast while moving, one beautiful frame at rest.
    frame(slow);
    expect(tiers.at(-1)).toBe('fast');
    governor.setMoving('orbit', false);
    advance(SETTLE_MS);
    drawRequested();
    expect(tiers.at(-1)).toBe('beautiful');
    // One toast, not one per frame.
    expect(loop.steps).toEqual(['auto']);
  });

  it('does not step down at 40 ms, nor for a few slow frames among fast ones', () => {
    const { governor, frame, loop } = setup({ setting: 'beautiful', ready: true });
    governor.setMoving('orbit', true);
    frame(0);
    for (let i = 0; i < 3 * STEP_DOWN_FRAMES; i++) frame(SLOW_FRAME_MS);
    for (let i = 0; i < 3 * STEP_DOWN_FRAMES; i++) frame(i % 3 === 0 ? 200 : 16);
    expect(loop.steps).toEqual([]);
    expect(governor.perf().steppedDown).toBeUndefined();
  });

  it('counts consecutive frames only: a rest starts the count again', () => {
    const { governor, frame, advance, loop } = setup({ setting: 'beautiful', ready: true });
    for (let run = 0; run < 4; run++) {
      frame(1000);
      for (let i = 0; i < STEP_DOWN_FRAMES - 2; i++) frame(slow);
      advance(SETTLE_MS);
      expect(governor.state).toBe('settled');
    }
    expect(loop.steps).toEqual([]);
  });

  it('ignores a frame that compiled a shader when it judges frame times', () => {
    const { governor, frame, loop } = setup({ setting: 'beautiful', ready: true });
    governor.setMoving('orbit', true);
    frame(0);
    // Every second frame compiles and is slow; the others are quick.
    for (let i = 0; i < 4 * STEP_DOWN_FRAMES; i++)
      frame(i % 2 ? 900 : 16, { compiled: i % 2 === 1 });
    expect(loop.steps).toEqual([]);
    expect(governor.perf().p95FrameMs).toBe(16);
  });

  it('`auto` behaves as `fast` once a refined frame takes longer than 1 s', () => {
    const { governor, frame, advance, tiers, loop, drawRequested } = setup({
      setting: 'auto',
      ready: true,
    });
    frame(0);
    advance(SETTLE_MS);
    drawRequested(SLOW_REFINE_MS);
    expect(loop.steps).toEqual([]);
    frame(1000);
    advance(SETTLE_MS);
    drawRequested(SLOW_REFINE_MS + 1);
    expect(loop.steps).toEqual(['fast']);
    expect(governor.perf().steppedDown).toBe('fast');
    // No refined frame any more: the view settles with its fast frame.
    frame(1000);
    advance(SETTLE_MS);
    expect(loop.requests).toBe(0);
    expect(governor.state).toBe('settled');
    expect(tiers.at(-1)).toBe('fast');
  });

  it('a refined frame that compiled a shader steps nothing down', () => {
    const { governor, frame, advance, loop } = setup({ setting: 'auto', ready: true });
    frame(0);
    advance(SETTLE_MS);
    loop.requests = 0;
    governor.frameStarted();
    advance(SLOW_REFINE_MS * 2);
    governor.frameDrawn(report({ compiled: true }));
    expect(loop.steps).toEqual([]);
  });

  it('`beautiful` can step down twice: to `auto`, then to `fast`', () => {
    const { governor, frame, advance, loop, drawRequested } = setup({
      setting: 'beautiful',
      ready: true,
    });
    governor.setMoving('orbit', true);
    frame(0);
    for (let i = 0; i < STEP_DOWN_FRAMES; i++) frame(slow);
    // Now as `auto`: a fast frame while moving, then the refined one, which is too slow as well.
    frame(slow);
    governor.setMoving('orbit', false);
    advance(SETTLE_MS);
    drawRequested(SLOW_REFINE_MS + 1);
    expect(loop.steps).toEqual(['auto', 'fast']);
    expect(governor.effective).toBe('fast');
  });

  it('choosing a value clears the step down; it is not remembered by the setting', () => {
    const { governor, frame, loop } = setup({ setting: 'beautiful', ready: true });
    governor.setMoving('orbit', true);
    frame(0);
    for (let i = 0; i < STEP_DOWN_FRAMES; i++) frame(slow);
    expect(governor.effective).toBe('auto');
    expect(governor.perf().setting).toBe('beautiful');
    governor.setSetting('fast');
    governor.setSetting('beautiful');
    expect(governor.perf().steppedDown).toBeUndefined();
    expect(governor.tier()).toBe('beautiful');
    expect(loop.steps).toEqual(['auto']);
  });

  it('`?stepdown=off` never steps down', () => {
    const { governor, frame, advance, loop, drawRequested } = setup({
      setting: 'beautiful',
      ready: true,
      stepDown: false,
    });
    governor.setMoving('orbit', true);
    frame(0);
    for (let i = 0; i < 3 * STEP_DOWN_FRAMES; i++) frame(slow);
    governor.setMoving('orbit', false);
    expect(loop.steps).toEqual([]);
    expect(governor.tier()).toBe('beautiful');
    governor.setSetting('auto');
    drawRequested();
    advance(SETTLE_MS);
    drawRequested(5 * SLOW_REFINE_MS);
    expect(loop.steps).toEqual([]);
    expect(governor.effective).toBe('auto');
  });
});
