// Run by overlay-shots.sh; not meant to be called directly.
//   node overlay-shots.mjs <out-dir> <home> <width> <height> <opacity> <photo-id>...   (SITE_BASE, SITE_HOST,
//   SITE_TOKEN from with-site-token.sh; Playwright from MY_HOME_PLAYWRIGHT_DIR, outside the repository)
// For each photo: open the gallery, select the photo, "View from here", hide the panels and shoot the model
// (<id8>-model.png); then "Lay the photo over the 3D view" at the given opacity (<id8>-overlay.png).
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.join(process.env.MY_HOME_PLAYWRIGHT_DIR, 'package.json'));
const { chromium } = require('playwright');

const { SITE_BASE, SITE_HOST, SITE_TOKEN = '' } = process.env;
const [out, home, width, height, opacity, ...ids] = process.argv.slice(2);
const LAUNCH_ARGS = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
// SwiftShader renders a frame in seconds, not milliseconds: screenshots need a long timeout.
const SHOT_TIMEOUT = 120_000;
const HIDE_UI = '.panel, .photos-panel, header, nav { visibility: hidden !important; }';

const redact = (text) => {
  let s = String(text).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted-jwt]');
  if (SITE_TOKEN.length >= 8) s = s.split(SITE_TOKEN).join('[redacted]');
  return s;
};

const browser = await chromium.launch({ args: LAUNCH_ARGS });
let failed = 0;
try {
  for (const id of ids) {
    const context = await browser.newContext({
      baseURL: SITE_BASE,
      viewport: { width: Number(width), height: Number(height) },
    });
    // The token goes only to the environment's own host, never to third parties.
    await context.route('**/*', (route) => {
      const request = route.request();
      if (new URL(request.url()).host !== SITE_HOST) return route.continue();
      return route.continue({
        headers: { ...request.headers(), authorization: `Bearer ${SITE_TOKEN}` },
      });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(redact(e.message)));
    try {
      await page.goto(`/?home=${encodeURIComponent(home)}&panel=photos&hints=off`);
      await page.waitForSelector('canvas', { timeout: 60_000 });
      await page.waitForTimeout(4000);
      await page
        .locator(`button.thumbnail:has(img[src*="${id}"])`)
        .first()
        .click({ timeout: 30_000 });
      await page.getByRole('button', { name: 'View from here' }).click({ timeout: 30_000 });
      await page.waitForTimeout(3000);
      const hidden = await page.addStyleTag({ content: HIDE_UI });
      await page.waitForTimeout(1000);
      const short = id.slice(0, 8);
      await page.screenshot({ path: path.join(out, `${short}-model.png`), timeout: SHOT_TIMEOUT });
      await hidden.evaluate((node) => node.remove());
      await page.getByLabel('Lay the photo over the 3D view').check();
      // By its label: the pose editor below it has range inputs too.
      await page.locator('.overlay-settings').getByLabel('Opacity').fill(opacity);
      await page.addStyleTag({ content: HIDE_UI });
      await page.waitForTimeout(2000);
      await page.screenshot({
        path: path.join(out, `${short}-overlay.png`),
        timeout: SHOT_TIMEOUT,
      });
      console.log(`ok    ${id}${errors.length ? ` (page errors: ${errors.join('; ')})` : ''}`);
    } catch (e) {
      failed += 1;
      console.log(`FAIL  ${id}: ${redact(e.message).split('\n')[0]}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
