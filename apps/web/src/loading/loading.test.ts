import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  afterEffects,
  beginLoading,
  GIVE_UP_MS,
  HOLD_MS,
  LEAVE_MS,
  loadingProgress,
  PLANS,
  resetLoadingForTests,
  stopLoading,
} from './loading';

/** progress.js's element, as far as the loading screen uses it. */
class FakeProgress extends HTMLElement {
  values: number[] = [];
  resets = 0;
  set(n: number) {
    this.values.push(n);
  }
  reset() {
    this.resets += 1;
  }
}

const BOOT =
  '<div class="boot-card"><sakuga-progress label="Loading my-home"></sakuga-progress></div>';
const boot = () => document.getElementById('boot');
const bar = () => boot()?.querySelector('sakuga-progress') as FakeProgress;
const last = () => bar().values.at(-1);
const reduceMotion = (on: boolean) =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: on })),
  );

beforeAll(() => customElements.define('sakuga-progress', FakeProgress));

beforeEach(() => {
  vi.useFakeTimers();
  reduceMotion(false);
  document.body.innerHTML = `<div id="root"></div><div id="boot" class="boot">${BOOT}</div>`;
});

afterEach(() => {
  resetLoadingForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const finishViewer = () => {
  for (const step of ['homes', 'home', 'views', 'scene', 'textures'] as const)
    loadingProgress(step);
};

describe('the loading screen', () => {
  it('plans add up to the whole bar', () => {
    for (const plan of Object.values(PLANS))
      expect(Object.values(plan).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it('starts with the main chunk loaded and moves only with real steps', () => {
    beginLoading('viewer');
    expect(last()).toBeCloseTo(PLANS.viewer.app);
    loadingProgress('homes');
    loadingProgress('home');
    expect(last()).toBeCloseTo(PLANS.viewer.app + PLANS.viewer.homes + PLANS.viewer.home);
    vi.advanceTimersByTime(10_000);
    expect(last()).toBeCloseTo(PLANS.viewer.app + PLANS.viewer.homes + PLANS.viewer.home);
  });

  it('follows part of a step, never backwards', () => {
    beginLoading('viewer');
    loadingProgress('textures', 0.5);
    const half = last()!;
    expect(half).toBeCloseTo(PLANS.viewer.app + PLANS.viewer.textures / 2);
    loadingProgress('textures', 0.2);
    expect(last()).toBe(half);
  });

  it('ignores a step the current plan does not have', () => {
    beginLoading('page');
    loadingProgress('scene');
    expect(bar().values).toEqual([PLANS.page.app]);
  });

  it('lifts the backdrop once the first frame is drawn, before the textures', () => {
    beginLoading('viewer');
    loadingProgress('home');
    expect(boot()!.hasAttribute('data-backdrop')).toBe(false);
    loadingProgress('scene');
    expect(boot()!.getAttribute('data-backdrop')).toBe('off');
    expect(boot()).not.toBeNull();
  });

  it('fills, plays its end, then shrinks away', () => {
    beginLoading('viewer');
    finishViewer();
    expect(last()).toBe(1);
    // Until the bar itself has reached the end, it stays.
    vi.advanceTimersByTime(HOLD_MS + LEAVE_MS);
    expect(boot()).not.toBeNull();
    bar().dispatchEvent(new CustomEvent('sakuga:done'));
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(boot()!.hasAttribute('data-leaving')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(boot()!.hasAttribute('data-leaving')).toBe(true);
    vi.advanceTimersByTime(LEAVE_MS);
    expect(boot()).toBeNull();
  });

  it('with reduced motion still fills, and goes as soon as it is full', () => {
    reduceMotion(true);
    beginLoading('page');
    loadingProgress('page');
    expect(last()).toBe(1);
    bar().dispatchEvent(new CustomEvent('sakuga:done'));
    expect(boot()).toBeNull();
  });

  it('goes at once, unfilled, when the load fails', () => {
    beginLoading('viewer');
    loadingProgress('homes');
    stopLoading();
    expect(boot()).toBeNull();
  });

  it('is made again for a later load, and starts from nothing', () => {
    beginLoading('page');
    stopLoading();
    beginLoading('viewer');
    expect(boot()).not.toBeNull();
    expect(bar().resets).toBe(1);
    expect(bar().values).toEqual([PLANS.viewer.app]);
  });

  it('a second begin of the same plan while loading changes nothing', () => {
    beginLoading('viewer');
    loadingProgress('home');
    beginLoading('viewer');
    expect(bar().resets).toBe(1);
    expect(last()).toBeCloseTo(PLANS.viewer.app + PLANS.viewer.home);
  });

  it("holds on Sakuga's clock when the core is there, so the card waits for its ドン!", () => {
    const later = vi.fn();
    vi.stubGlobal('SakugaFX', { later });
    const run = vi.fn();
    afterEffects(HOLD_MS, run);
    expect(later).toHaveBeenCalledWith(HOLD_MS, run);
    vi.advanceTimersByTime(HOLD_MS);
    expect(run).not.toHaveBeenCalled();
  });

  it('gets out of the way when a step never comes', () => {
    beginLoading('viewer');
    vi.advanceTimersByTime(GIVE_UP_MS);
    expect(boot()).toBeNull();
  });
});
