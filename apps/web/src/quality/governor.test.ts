import { describe, expect, it } from 'vitest';
import {
  FrameGovernor,
  RECENT_MS,
  SETTLE_MS,
  type FrameReport,
  type GovernorClock,
} from './governor';

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
  shadowLights: 1,
  litLamps: 0,
  ...patch,
});

function setup() {
  const { clock, advance } = fakeClock();
  const governor = new FrameGovernor(clock);
  const seen: string[] = [];
  governor.onChange = (state, tier) => seen.push(`${state}/${tier}`);
  /** Draws a frame `ms` after the last one. */
  const frame = (ms: number, patch?: Partial<FrameReport>) => {
    advance(ms);
    governor.frameStarted();
    governor.frameDrawn(report(patch));
  };
  return { governor, advance, seen, frame };
}

describe('the frame governor', () => {
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
    const { governor, advance, frame } = setup();
    governor.setMoving('orbit', true);
    frame(0);
    advance(1000);
    expect(governor.state).toBe('moving');
    expect(governor.moving).toBe(true);
    governor.setMoving('orbit', false);
    let pending = true;
    governor.framePending = () => pending;
    advance(SETTLE_MS);
    expect(governor.state).toBe('moving');
    pending = false;
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

  it('draws the fast tier in every setting until the beautiful tier exists (#111)', () => {
    const { governor, seen } = setup();
    for (const setting of ['fast', 'auto', 'beautiful'] as const) {
      governor.setSetting(setting);
      expect(governor.tier()).toBe('fast');
      expect(governor.perf().setting).toBe(setting);
    }
    // The canvas is marked again when the setting changes.
    expect(seen).toEqual(['moving/fast', 'moving/fast']);
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
