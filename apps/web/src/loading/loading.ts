/**
 * The loading screen: Sakuga VFX's `<sakuga-progress>` in `#boot` (index.html), on screen from the
 * first paint, ahead of the main chunk (`sakuga-plugin.ts`). This module drives it once the
 * main chunk runs (docs/loading.md).
 *
 * It shows real progress only: each step moves when the thing it names has arrived, never on a
 * timer. The main chunk is the step `app`, done by the time any of this runs; the bar sits at 0
 * until then. A session ends when every step of its plan is done: the bar fills, plays its end
 * (the burst, ドン! and the check), then the card leaves by shrinking. A failure (an api error, no
 * homes) takes the screen away at once, with no end, and the page says what went wrong.
 */

/** What is loading, and how much of the bar each step is worth. */
export const PLANS = {
  /** `/`: the 3D view. Textures are the most bytes, the main chunk the longest wait on a phone. */
  viewer: { app: 0.25, homes: 0.05, home: 0.15, views: 0.05, scene: 0.15, textures: 0.35 },
  /** A lazy page (`/catalog`, a piece): its chunk. */
  page: { app: 0.5, page: 0.5 },
} as const;

export type Plan = keyof typeof PLANS;
export type Step = { [P in Plan]: keyof (typeof PLANS)[P] }[Plan];

/** The step after which the page under the screen may be seen: the backdrop goes, the card stays. */
const SHOWN: Record<Plan, Step> = { viewer: 'scene', page: 'page' };

/**
 * From `sakuga:done` until the card shrinks: the burst and ドン! play out (1.05 s, progress.js). On
 * Sakuga's own clock (`afterEffects`), which runs slower than the wall on a slow device.
 */
export const HOLD_MS = 1100;
/** The card's shrink (index.html `.boot-card`). */
export const LEAVE_MS = 180;
/** A step that never comes (no WebGL, a hung request): the screen gets out of the way, unfilled. */
export const GIVE_UP_MS = 90_000;

/**
 * Runs `run` once `ms` of the effects' time has passed: on the clock Sakuga VFX draws by
 * (`SakugaFX.later`), so a card leaves after its ドン! on a device that draws few frames a second
 * too. Without the core (its script did not load, jsdom) on a timer. It cannot be cancelled: `run`
 * checks whether it is still wanted.
 */
export function afterEffects(ms: number, run: () => void): void {
  const fx = (window as { SakugaFX?: { later?: (ms: number, run: () => void) => void } }).SakugaFX;
  if (fx?.later) fx.later(ms, run);
  else setTimeout(run, ms);
}

/** The parts of `<sakuga-progress>` used here (packages/sakuga-vfx/progress/README.md). */
interface ProgressElement extends HTMLElement {
  set(n: number, instant?: boolean): void;
  reset(): void;
}

interface Session {
  plan: Plan;
  done: Map<string, number>;
  ending: boolean;
  timers: ReturnType<typeof setTimeout>[];
}

let session: Session | undefined;

const calm = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** The screen, made again for a later load once the first one has gone. */
function screen(): { boot: HTMLElement; bar: HTMLElement } {
  let boot = document.getElementById('boot');
  if (!boot) {
    boot = document.createElement('div');
    boot.id = 'boot';
    boot.className = 'boot';
    boot.innerHTML =
      '<div class="boot-card"><sakuga-progress label="Loading my-home"></sakuga-progress></div>';
    document.body.append(boot);
  }
  return { boot, bar: boot.querySelector('sakuga-progress') as HTMLElement };
}

/** The element is upgraded: progress.js ran. Without it the screen still comes and goes. */
const upgraded = (bar: HTMLElement): bar is ProgressElement =>
  typeof (bar as Partial<ProgressElement>).set === 'function';

/** Full when every step is done, and only then: the weights' sum is not exactly 1 in floats. */
function value(s: Session): number {
  let sum = 0;
  let complete = true;
  for (const [step, weight] of Object.entries(PLANS[s.plan])) {
    const done = s.done.get(step) ?? 0;
    sum += weight * done;
    if (done < 1) complete = false;
  }
  return complete ? 1 : Math.min(0.99, sum);
}

function clearTimers(s: Session) {
  for (const timer of s.timers) clearTimeout(timer);
  s.timers = [];
}

function remove(s: Session) {
  clearTimers(s);
  if (session === s) session = undefined;
  document.getElementById('boot')?.remove();
}

/** The bar is full: let its end play, then shrink the card away. */
function end(s: Session, bar: HTMLElement) {
  s.ending = true;
  const leave = () => {
    if (session !== s) return;
    if (calm()) return remove(s);
    afterEffects(HOLD_MS, () => {
      if (session !== s) return;
      document.getElementById('boot')?.setAttribute('data-leaving', '');
      s.timers.push(setTimeout(() => remove(s), LEAVE_MS));
    });
  };
  if (!upgraded(bar)) return leave();
  // `sakuga:done` fires when the bar itself has reached the end, a moment after set(1).
  bar.addEventListener('sakuga:done', leave, { once: true });
}

function show(s: Session) {
  const { boot, bar } = screen();
  if ((s.done.get(SHOWN[s.plan]) ?? 0) >= 1) boot.setAttribute('data-backdrop', 'off');
  const v = value(s);
  if (upgraded(bar)) bar.set(v);
  if (v >= 1 && !s.ending) end(s, bar);
}

/**
 * A load starts: the screen shows (made again if an earlier one has gone) and follows `plan`. The
 * main chunk has run, so `app` is done. The same plan again while it loads changes nothing (a
 * remounted component); another plan replaces it (the address changed).
 */
export function beginLoading(plan: Plan): void {
  if (session?.plan === plan && !session.ending) return;
  if (session) clearTimers(session);
  const { boot, bar } = screen();
  boot.removeAttribute('data-leaving');
  boot.removeAttribute('data-backdrop');
  if (upgraded(bar)) bar.reset();
  const s: Session = { plan, done: new Map([['app', 1]]), ending: false, timers: [] };
  session = s;
  s.timers.push(setTimeout(() => remove(s), GIVE_UP_MS));
  show(s);
}

/**
 * A step of the current load has got this far (0 to 1). A step only moves forward: a lower number
 * later is ignored, so the bar never goes back. A step the current plan does not have is ignored.
 */
export function loadingProgress(step: Step, fraction = 1): void {
  const s = session;
  if (!s || s.ending || !(step in PLANS[s.plan])) return;
  const f = Math.max(s.done.get(step) ?? 0, Math.min(1, Math.max(0, fraction)));
  if (f === s.done.get(step)) return;
  s.done.set(step, f);
  show(s);
}

/**
 * The load failed, or there is nothing to load (no homes, a page that does not exist): the screen
 * goes at once, unfilled, with no end, and the page says what is wrong. With `plan`, only a load of
 * that plan is stopped: a viewer that unmounts ends its own load, never the page's that replaced it
 * (React calls the next page's lazy chunk in the render before the viewer's cleanup).
 */
export function stopLoading(plan?: Plan): void {
  if (plan !== undefined && session?.plan !== plan) return;
  if (session) remove(session);
  else document.getElementById('boot')?.remove();
}

/** For tests: forget the current load. */
export function resetLoadingForTests(): void {
  if (session) clearTimers(session);
  session = undefined;
}
