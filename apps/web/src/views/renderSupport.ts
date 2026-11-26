/**
 * Whether this browser can make path-traced renders (docs/design/realistic-render.md §9): it
 * needs WebGPU on a real graphics card. Asked before render mode's chunk is, so that a browser
 * without it downloads nothing.
 */
export type RenderSupport =
  /** WebGPU on a graphics card. */
  | 'ok'
  /** WebGPU, but drawn by the processor: a still would take hours. */
  | 'software'
  | 'none';

interface Adapter {
  info?: { isFallbackAdapter?: boolean; architecture?: string };
  isFallbackAdapter?: boolean;
}
interface Gpu {
  requestAdapter(): Promise<Adapter | null>;
}

export async function renderSupport(
  gpu: Gpu | undefined = (navigator as Navigator & { gpu?: Gpu }).gpu,
): Promise<RenderSupport> {
  if (!gpu) return 'none';
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return 'none';
    // Chromium's software adapter says so by its flag, and by its name where the flag is missing.
    const software =
      (adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter) === true ||
      adapter.info?.architecture === 'swiftshader';
    return software ? 'software' : 'ok';
  } catch {
    return 'none';
  }
}

/** The one sentence a browser without it gets (§9). */
export const NO_RENDER = 'This browser cannot make path-traced renders';
