// What the browser scripts wait for and shoot on a page of my-home. Shared by screenshot.mjs and the smokes.
//
// The app's HUD (packages/sakuga-vfx) draws its effects on canvases of its own: one over the whole page,
// canvas.sakuga-fx (in <body> from the loading screen's first effect on, for good), and one inside a control,
// canvas.back (in its shadow root, which Playwright's CSS selectors reach). Neither is the scene: a bare
// `canvas` would find one of them before the 3D view exists, and count them as a viewer.

/** The scene's canvas: the 3D view's, or a piece page's. Never one of the HUD's effect layers. */
export const SCENE = 'canvas:not(.sakuga-fx):not(.back)';

/**
 * The loading screen (#boot, apps/web/src/loading/loading.ts) has played its end and gone. It never catches a
 * tap, but it covers a screenshot, and its exit runs on the page's timers (a paused clock would hold it).
 * It goes when the view and its textures are in, so a settled view is followed by this within seconds.
 */
export async function loadingScreenGone(page, timeout = 30_000) {
  await page.waitForSelector('#boot', { state: 'detached', timeout });
}
