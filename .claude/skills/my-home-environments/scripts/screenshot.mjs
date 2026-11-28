// Run by screenshot.sh; not meant to be called directly.
//   node screenshot.mjs --check
//   node screenshot.mjs <out.png> <path> <wait-ms> <width> <height> [actions-json] [touch] [canvas]   (SITE_BASE, SITE_TOKEN from with-site-token.sh)
// Playwright is loaded from MY_HOME_PLAYWRIGHT_DIR, outside the repository.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { answeredInfrastructure } from './infrastructure.mjs';
import { stopwatch } from './parts.mjs';
import { loadingScreenGone, SCENE } from './scene.mjs';

const require = createRequire(path.join(process.env.MY_HOME_PLAYWRIGHT_DIR, 'package.json'));
const { chromium } = require('playwright');
const { version } = require('playwright/package.json');

/**
 * --canvas with a drag: page time is paused before the first drag and runs exactly this long after
 * each action. The orbit controls' damping then ends in the same place on every run, however fast
 * or slow the software renderer is (at 1-4 frames per second, waiting in real time does not do).
 */
const SETTLE_MS = 1000;

/**
 * How long a screenshot may take. The browser draws in software here: a frame of the lit scene
 * takes seconds, and a shot waits until the frames before it are drawn.
 */
const SHOT_TIMEOUT_MS = 180_000;

const LAUNCH_ARGS = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const token = process.env.SITE_TOKEN ?? '';

// Never let the token, or anything token-shaped, reach the output.
const redact = (text) => {
  let out = String(text).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted-jwt]');
  if (token.length >= 8) out = out.split(token).join('[redacted]');
  return out;
};

async function check() {
  console.log(`playwright ${version} in ${process.env.MY_HOME_PLAYWRIGHT_DIR}`);
  console.log(`chromium ${chromium.executablePath()}`);
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  console.log(`headless launch ok: chromium ${browser.version()}`);
  await browser.close();
}

/** How long a shot waits for the view to settle: a software renderer takes seconds per frame. */
const SETTLED_TIMEOUT_MS = 240_000;

/**
 * Waits for the settled frame (docs/design/realistic-render.md §6.7): the frame governor marks the
 * canvas `data-frame="settled"` once the last frame is drawn and nothing asks for another. With
 * `?quality=auto` or `beautiful` in the address it also waits for the beautiful tier, which comes
 * with a lazy chunk after the first frames. A build before #110 has no such mark and is not waited
 * for; a view that does not settle in time is shot as it is, with a warning.
 */
async function settled(page) {
  const canvas = page.locator(SCENE).first();
  if ((await canvas.getAttribute('data-frame').catch(() => null)) === null) return;
  const quality = new URL(page.url()).searchParams.get('quality');
  const tier = quality === 'auto' || quality === 'beautiful' ? '[data-tier="beautiful"]' : '';
  await page
    .waitForSelector(`canvas[data-frame="settled"]${tier}`, { timeout: SETTLED_TIMEOUT_MS })
    .catch(() =>
      console.log(`warning: the view did not settle${tier && ' in the beautiful tier'}`),
    );
}

/**
 * Runs click, optional click, drag, pad and key actions in order.
 * Drags start at the canvas centre; `pad` holds the walk mode's movement pad deflected, `key` holds a key.
 */
async function runActions(page, actions, settle) {
  let paused = false;
  for (const action of actions) {
    const selector = action.click ?? action.clickIfPresent;
    if (selector !== undefined) {
      const target = page.locator(selector).first();
      if (action.clickIfPresent !== undefined && !(await target.isVisible())) continue;
      console.log(`click ${selector}`);
      await target.click({ timeout: 15_000 });
    } else if (action.pad) {
      const [dx, dy, ms] = action.pad;
      const box = await page.locator('.joystick').first().boundingBox({ timeout: 15_000 });
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      console.log(`pad ${dx},${dy} for ${ms} ms`);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 5 });
      await page.waitForTimeout(ms);
      await page.mouse.up();
    } else if (action.key) {
      const [key, ms] = action.key;
      console.log(`key ${key} for ${ms} ms`);
      await page.keyboard.down(key);
      await page.waitForTimeout(Number(ms));
      await page.keyboard.up(key);
    } else if (action.drag) {
      const [dx, dy] = action.drag;
      if (settle && !paused) {
        // Not earlier: Playwright's clicks wait for animation frames, which a paused clock stops.
        await page.clock.install();
        await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
        paused = true;
      }
      const box = await page.locator(SCENE).first().boundingBox();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      console.log(`drag ${dx},${dy}`);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 20 });
      await page.mouse.up();
    }
    if (paused) await page.clock.runFor(SETTLE_MS);
    else await page.waitForTimeout(1000);
  }
  return paused;
}

async function shoot([
  out,
  target,
  waitMs,
  width,
  height,
  actions = '[]',
  touch = '',
  canvas = '',
]) {
  const base = process.env.SITE_BASE;
  const host = new URL(base).host;
  const lap = stopwatch();
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  try {
    // `touch` emulates a phone: a touch screen with a coarse pointer and a mobile viewport.
    const context = await browser.newContext({
      viewport: { width: Number(width), height: Number(height) },
      ...(touch === 'touch' && { hasTouch: true, isMobile: true }),
    });
    // The site token goes only to the environment's own host, never to any third-party request.
    await context.route('**/*', (route) => {
      const request = route.request();
      if (new URL(request.url()).host !== host) return route.continue();
      // Cloudflare's own requests (its analytics beacon) are answered here: no write, no error.
      if (answeredInfrastructure(route, host)) return;
      // Read-only: no write leaves the browser (nothing is stored on a deployed environment).
      if (!['GET', 'HEAD'].includes(request.method())) return route.abort();
      return route.continue({
        headers: { ...request.headers(), authorization: `Bearer ${token}` },
      });
    });
    const page = await context.newPage();
    lap('launch');
    const errors = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });

    const response = await page.goto(new URL(target, base).href, {
      waitUntil: 'networkidle',
      timeout: 60_000,
    });
    const finalHost = new URL(page.url()).host;
    console.log(`final host ${finalHost}, status ${response?.status() ?? 'none'}`);
    if (finalHost !== host) throw new Error(`ended on ${finalHost}, not ${host} (login redirect?)`);
    // An error page has no canvas to wait for: say what the environment answered, at once.
    const status = response?.status() ?? 0;
    if (status >= 400)
      throw new Error(`${host} answered ${status} for the page: the environment, not the view`);
    // The viewer (`/`) draws a canvas; the other pages (`/catalog`, …) have a heading instead.
    const viewer = new URL(page.url()).pathname === '/';
    await page.waitForSelector(viewer ? SCENE : 'h1', { timeout: 30_000 });
    lap('load');
    await page.waitForTimeout(Number(waitMs));
    lap('wait');
    console.log(`title ${await page.title()}`);
    if (viewer) await settled(page);
    // Its exit runs on the page's timers, which the actions may pause; it covers the shot (scene.mjs).
    await loadingScreenGone(page, viewer ? 30_000 : 60_000).catch(() =>
      console.log('warning: the loading screen is still up'),
    );
    lap('settle');
    const paused = await runActions(page, JSON.parse(actions), canvas === 'canvas');
    // Not with a paused clock: there the frames after a drag are run by hand (SETTLE_MS).
    if (viewer && !paused) await settled(page);
    lap('actions');
    if (canvas === 'canvas') {
      // Only the 3D view: hide every other element (visibility keeps the layout, so nothing redraws)
      // and clip to the canvas.
      await page.addStyleTag({
        content: `* { visibility: hidden !important; } ${SCENE} { visibility: visible !important; }`,
      });
      await page.waitForTimeout(500);
      if (paused) {
        // Playwright's screenshots wait for an animation frame; the browser's own capture does not.
        const { x, y, width, height } = await page.locator(SCENE).first().boundingBox();
        const cdp = await context.newCDPSession(page);
        const { data } = await cdp.send('Page.captureScreenshot', {
          format: 'png',
          clip: { x, y, width, height, scale: 1 },
        });
        writeFileSync(out, Buffer.from(data, 'base64'));
      } else {
        await page
          .locator(SCENE)
          .first()
          .screenshot({ path: out, animations: 'disabled', timeout: SHOT_TIMEOUT_MS });
      }
    } else {
      await page.screenshot({ path: out, timeout: SHOT_TIMEOUT_MS });
    }
    lap('shot');
    console.log(`errors ${errors.length ? '' : 'none'}`);
    for (const error of errors.slice(0, 10)) console.log(`  ${redact(error)}`);
    console.log(`screenshot ${out}`);
  } finally {
    await browser.close();
  }
}

const args = process.argv.slice(2);
(args[0] === '--check' ? check() : shoot(args)).catch((error) => {
  console.error(`FAILED: ${redact(error.message)}`);
  process.exit(1);
});
