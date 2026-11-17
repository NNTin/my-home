// Run by walk-smoke.sh; not meant to be called directly.
//   node walk-smoke.mjs <out.png>   (SITE_BASE, SITE_TOKEN from with-site-token.sh)
// Smoke test of walk mode on a phone-sized screen: the movement pad walks and turns the figure, the
// overview follows it, and nothing logs an error. Playwright is loaded from MY_HOME_PLAYWRIGHT_DIR.
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.join(process.env.MY_HOME_PLAYWRIGHT_DIR, 'package.json'));
const { chromium } = require('playwright');

const token = process.env.SITE_TOKEN ?? '';
const redact = (text) => {
  let out = String(text).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted-jwt]');
  if (token.length >= 8) out = out.split(token).join('[redacted]');
  return out;
};

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

async function smoke(out) {
  const base = process.env.SITE_BASE;
  const host = new URL(base).host;
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    // A phone held upright, with a touch screen.
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
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

    await page.goto(new URL('/?walk=first', base).href, {
      waitUntil: 'networkidle',
      timeout: 60_000,
    });
    if (new URL(page.url()).host !== host)
      throw new Error('ended on another host (login redirect?)');
    await page.waitForSelector('canvas', { timeout: 30_000 });
    const hud = page.locator('[data-testid=walk-hud]');
    await hud.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(4000);

    const figure = async () => {
      const data = await hud.evaluate((element) => ({ ...element.dataset }));
      return { x: Number(data.x), z: Number(data.z), yaw: Number(data.yaw), level: data.level };
    };
    const where = () => page.locator('.walk-where').innerText();
    /** Holds the movement pad deflected by (dx, dy) pixels until `done` or a timeout. */
    const pad = async (dx, dy, done) => {
      const box = await page.locator('.joystick').boundingBox();
      const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 5 });
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline && !(await done())) await page.waitForTimeout(250);
      await page.mouse.up();
      await page.waitForTimeout(500);
    };

    const start = await figure();
    console.log(`start ${JSON.stringify(start)} in "${await where()}"`);
    check('the figure starts on a level', start.level !== '', start.level);
    const pads = await page.locator('.joystick').boundingBox();
    const shutter = await page.locator('.shutter').boundingBox();
    check('the movement pad is on screen', pads.x >= 0 && pads.y + pads.height <= 844);
    check(
      'the camera button is on screen',
      shutter.x + shutter.width <= 390 && shutter.y + shutter.height <= 844,
    );

    const moved = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    await pad(0, -44, async () => moved(await figure(), start) > 0.5);
    const walked = await figure();
    check(
      'pushing the pad up walks the figure',
      moved(walked, start) > 0.5,
      `${moved(walked, start).toFixed(2)} m`,
    );

    await pad(-44, 0, async () => Math.abs((await figure()).yaw - walked.yaw) > 0.3);
    const turned = await figure();
    check('pushing the pad left turns it left', Math.abs(turned.yaw - walked.yaw) > 0.3);

    await page.waitForTimeout(600);
    const rest = await figure();
    await page.waitForTimeout(600);
    check('it stands still when the pad is released', moved(await figure(), rest) === 0);

    await page.getByRole('button', { name: 'Overview' }).click();
    await page.waitForTimeout(2500);
    check(
      'the overview has no look layer over the canvas',
      (await page.locator('.walk-look').count()) === 0,
    );
    await page.screenshot({ path: out });
    console.log(`end ${JSON.stringify(await figure())} in "${await where()}"`);
    // Leaving walk mode logs nothing, whichever way in: the first-person walk above, the overview
    // opened by address, and a walk restored after a reload (issue #31: a removeChild page error
    // when the room names change as the overview is left).
    const exit = async (label) => {
      const before = errors.length;
      await page.getByRole('button', { name: /Exit/ }).click();
      await hud.waitFor({ state: 'detached', timeout: 10_000 });
      await page.waitForTimeout(1500);
      check(
        `leaving ${label} logs no error`,
        errors.length === before,
        errors
          .slice(before, before + 3)
          .map(redact)
          .join(' | '),
      );
    };
    const open = async (path) => {
      await page.goto(new URL(path, base).href, { waitUntil: 'networkidle', timeout: 60_000 });
      await hud.waitFor({ timeout: 30_000 });
      await page.waitForTimeout(3000);
    };
    await exit('the overview of a walk');
    await open('/?walk=third');
    await exit('the overview opened by address');
    await open('/?walk=first');
    await page.reload({ waitUntil: 'networkidle' });
    await hud.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(3000);
    await exit('a walk restored after a reload');
    check(
      'no console or page errors',
      errors.length === 0,
      errors.slice(0, 5).map(redact).join(' | '),
    );
    console.log(`screenshot ${out}`);
  } finally {
    await browser.close();
  }
}

smoke(process.argv[2]).then(
  () => {
    console.log(failures.length ? `FAILED: ${failures.join('; ')}` : 'walk smoke test passed');
    process.exit(failures.length ? 1 : 0);
  },
  (error) => {
    console.error(`FAILED: ${redact(error.message)}`);
    process.exit(1);
  },
);
