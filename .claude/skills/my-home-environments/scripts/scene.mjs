// What the browser scripts wait for and shoot on a page of my-home. Shared by screenshot.mjs and the smokes.
//
// The app's HUD (packages/sakuga-vfx) draws its effects on canvases of its own: one over the whole page,
// canvas.sakuga-fx (in <body> from the loading screen's first effect on, for good), and one inside a control,
// canvas.back (in its shadow root, which Playwright's CSS selectors reach), and the painted toggle draws its
// frames on canvas.art in its shadow root (#168 PR 4). None is the scene: a bare `canvas` would find one of
// them before the 3D view exists, and count them as a viewer.

/** The scene's canvas: the 3D view's, or a piece page's. Never one of the HUD's effect layers. */
export const SCENE = 'canvas:not(.sakuga-fx):not(.back):not(.art)';

/**
 * The loading screen (#boot, apps/web/src/loading/loading.ts) has played its end and gone. It never catches a
 * tap, but it covers a screenshot, and its exit runs on the page's timers (a paused clock would hold it).
 * It goes when the view and its textures are in, so a settled view is followed by this within seconds.
 */
export async function loadingScreenGone(page, timeout = 30_000) {
  await page.waitForSelector('#boot', { state: 'detached', timeout });
}

/**
 * The controls among `elements` that do not take a touch `min` px across (run in the page, by
 * `evaluateAll`). A compact Sakuga control draws a 34 px face and takes touches 44 px across inside
 * its shadow root (docs/design/hud.md §3.3), which no box shows; so each control is hit-tested:
 * `elementFromPoint` at the middle of each edge of the `min`-px square around its centre (or of its
 * box, if larger), 1 px inside, and at the centre must land on the control (a probe past the screen's
 * edge is moved onto it). The CSS reaches into shadow roots: an inner control stands for its host,
 * which `elementFromPoint` returns for it. Corners are not probed: Chrome hit-tests rounded corners.
 */
/* global document, window -- missedTouches runs in the page (Playwright's evaluateAll) */
export function missedTouches(elements, min) {
  const [W, H] = [document.documentElement.clientWidth, document.documentElement.clientHeight];
  const scroll = [window.scrollX, window.scrollY];
  const small = elements
    .filter((e) => e.getClientRects().length > 0)
    .map((e) => {
      const owner = e.getRootNode().host ?? e;
      // A point is hit-tested on the screen only: a control below the fold comes to its middle first.
      e.scrollIntoView({ block: 'center', inline: 'center' });
      const r = e.getBoundingClientRect();
      const [cx, cy] = [r.x + r.width / 2, r.y + r.height / 2];
      const [w, h] = [Math.max(r.width, min) / 2 - 1, Math.max(r.height, min) / 2 - 1];
      const missed = [
        [cx - w, cy],
        [cx + w, cy],
        [cx, cy - h],
        [cx, cy + h],
        [cx, cy],
      ].filter(([x, y]) => {
        const hit = document.elementFromPoint(
          Math.min(Math.max(x, 0), W - 1),
          Math.min(Math.max(y, 0), H - 1),
        );
        return !(hit && (hit === owner || owner.contains(hit)));
      });
      const name = owner.getAttribute('label') ?? e.getAttribute('aria-label') ?? e.textContent;
      return { name, missed, r };
    })
    .filter((e) => e.missed.length > 0)
    .map((e) => `${e.name.trim()} ${Math.round(e.r.width)}x${Math.round(e.r.height)}`);
  // The page as it was: the smoke goes on from where it stood.
  window.scrollTo(scroll[0], scroll[1]);
  return small;
}
