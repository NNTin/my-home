// Run by screenshot.sh; not meant to be called directly.
//   node screenshot.mjs --check
//   node screenshot.mjs <out.png> <path> <wait-ms> <width> <height> [actions-json] [touch] [canvas]   (SITE_BASE, SITE_TOKEN from with-site-token.sh)
// Playwright is loaded from MY_HOME_PLAYWRIGHT_DIR, outside the repository.
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.join(process.env.MY_HOME_PLAYWRIGHT_DIR, 'package.json'));
const { chromium } = require('playwright');
const { version } = require('playwright/package.json');

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

/**
 * Runs `[{ click: selector } | { drag: [dx, dy] } | { pad: [dx, dy, ms] } | { key: [key, ms] }]` in order.
 * Drags start at the canvas centre; `pad` holds the walk mode's movement pad deflected, `key` holds a key.
 */
async function runActions(page, actions) {
  for (const action of actions) {
    if (action.click !== undefined) {
      console.log(`click ${action.click}`);
      await page.locator(action.click).first().click({ timeout: 15_000 });
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
      const box = await page.locator('canvas').first().boundingBox();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      console.log(`drag ${dx},${dy}`);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 20 });
      await page.mouse.up();
    }
    await page.waitForTimeout(1000);
  }
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
      return route.continue({
        headers: { ...request.headers(), authorization: `Bearer ${token}` },
      });
    });
    const page = await context.newPage();
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
    await page.waitForSelector('canvas', { timeout: 30_000 });
    await page.waitForTimeout(Number(waitMs));
    console.log(`title ${await page.title()}`);
    await runActions(page, JSON.parse(actions));
    if (canvas === 'canvas') {
      // Only the 3D view: hide every other element (visibility keeps the layout, so nothing redraws)
      // and clip to the canvas.
      await page.addStyleTag({
        content: '* { visibility: hidden !important; } canvas { visibility: visible !important; }',
      });
      await page.waitForTimeout(500);
      await page.locator('canvas').first().screenshot({ path: out, animations: 'disabled' });
    } else {
      await page.screenshot({ path: out });
    }
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
