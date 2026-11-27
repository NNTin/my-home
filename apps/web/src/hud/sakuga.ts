/** What the app reads of `window.SakugaFX`, the core the loading bar's script sets (packages/sakuga-vfx). */
export interface SakugaApi {
  /** The clock stopped: `advance(dt)` steps it (look.mjs, the measuring page's word images). */
  paused: boolean;
  /** No effects: reduced motion, or set by the page (C3). */
  calm: boolean;
  /** The clock's own numbers (C1). */
  readonly stats: { frames: number; ms: number; awake: number; running: boolean };
  /** The base class of every element. */
  readonly Base: CustomElementConstructor;
  advance(dt: number): void;
  burst(x: number, y: number, options?: object): void;
  puff(x: number, y: number, options?: object): void;
  sfx(name: string, x: number, y: number, options?: object): void;
}

/** The core, or undefined where its script did not run (jsdom, a failed load). */
export const sakuga = () => (window as Window & { SakugaFX?: SakugaApi }).SakugaFX;
