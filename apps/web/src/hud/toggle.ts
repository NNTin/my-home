import { all, rest } from 'virtual:sakuga-toggle-frames';
import { sakuga } from './sakuga';

interface ToggleClass {
  frames: { rest: string; all: string } | null;
  warm(): void;
}

/**
 * The painted toggle's frames (docs/design/hud.md §9.3): once the loading screen has gone, the two rest frames
 * (8 kB); then, on idle and only with effects on, all 43 (346 kB), so the first flip plays the drawing. Until the
 * rest frames are there, each toggle is a switch in CSS, and it works.
 */
export function provideToggleFrames(): void {
  const give = () => {
    const toggle = customElements.get('sakuga-toggle') as unknown as ToggleClass | undefined;
    if (!toggle || !('warm' in toggle) || toggle.frames) return;
    toggle.frames = { rest, all };
    const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 2000));
    idle(() => {
      if (!sakuga()?.calm) toggle.warm();
    });
  };
  if (!document.getElementById('boot')) return give();
  const watch = new MutationObserver(() => {
    if (document.getElementById('boot')) return;
    watch.disconnect();
    give();
  });
  watch.observe(document.body, { childList: true, subtree: true });
}
