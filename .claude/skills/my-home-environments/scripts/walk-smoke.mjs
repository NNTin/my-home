// Run by walk-smoke.sh; not meant to be called directly.
//   node walk-smoke.mjs <out.png>   (SITE_BASE, SITE_TOKEN from with-site-token.sh)
// Smoke test of walk mode on a phone-sized screen: the movement pad walks and turns the figure, the
// overview follows it, the minimap tracks the figure (also up the stair, where it switches level)
// without covering a control, it walks under wall cabinets and lights (answered in the browser) but
// not through a cabinet on the floor, and nothing logs an error. Playwright is loaded from
// MY_HOME_PLAYWRIGHT_DIR. Read-only: moving the figure changes nothing on the environment.
/* global document */
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
      // Read-only: no write leaves the browser (nothing is stored on a deployed environment).
      if (!['GET', 'HEAD'].includes(request.method())) return route.abort();
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

    // The minimap: on screen, on the figure's level, where the figure is, and clear of the controls.
    const map = page.locator('.walk-map-svg');
    const onMap = async () => ({
      level: await map.getAttribute('data-level'),
      ...(await map
        .locator('.map-figure')
        .evaluate((e) => ({ x: Number(e.dataset.x), z: Number(e.dataset.z) }))),
    });
    const mapMatches = async () => {
      const [f, m] = [await figure(), await onMap()];
      return m.level === f.level && moved(f, m) < 0.05;
    };
    check(
      'the minimap shows the figure where it is',
      await mapMatches(),
      JSON.stringify(await onMap()),
    );
    const overlaps = (a, b) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    const mapBox = await page.locator('.walk-map').boundingBox();
    const others = [];
    for (const selector of ['.joystick', '.shutter', '.walk-tilt', '.walk-bar > *', '.compass']) {
      for (const element of await page.locator(selector).all()) {
        const box = await element.boundingBox();
        if (box && overlaps(mapBox, box)) others.push(selector);
      }
    }
    check(
      'the minimap is on screen and covers no control',
      mapBox.x >= 0 &&
        mapBox.x + mapBox.width <= 390 &&
        mapBox.y + mapBox.height <= 844 &&
        others.length === 0,
      others.join(', '),
    );
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
    check('the minimap followed the walk', await mapMatches(), JSON.stringify(await onMap()));

    await page.getByRole('button', { name: 'Overview' }).click();
    await page.waitForTimeout(2500);
    check(
      'the overview has no look layer over the canvas',
      (await page.locator('.walk-look').count()) === 0,
    );
    await page.screenshot({ path: out });

    // Up the stair from the figure's level (walked in the overview, which draws faster).
    const stair = await map.evaluate((svg, level) => {
      const element = [...svg.querySelectorAll('.map-stair')].find((e) => e.dataset.from === level);
      if (!element) return undefined;
      const centres = element
        .getAttribute('d')
        .split('Z')
        .filter((part) => part.includes('M'))
        .map((part) => {
          const points = part
            .replace('M', '')
            .split('L')
            .map((p) => p.trim().split(' ').map(Number));
          return [0, 1].map((i) => points.reduce((sum, p) => sum + p[i], 0) / points.length);
        });
      return { id: element.dataset.stair, to: element.dataset.to, centres };
    }, start.level);
    if (!stair) {
      check('a stair leads up from the starting level', false, start.level);
    } else {
      const [first, second = first] = stair.centres;
      // The foot of the stair: about two treads in front of the first one.
      const foot = [first[0] - (second[0] - first[0]) * 2, first[1] - (second[1] - first[1]) * 2];
      await page.locator('.walk-map').click();
      await page.getByRole('button', { name: /Move/ }).click();
      const screenOf = ([x, z]) =>
        page.evaluate(
          ([x, z]) => {
            const m = document.querySelector('.walk-map-large .walk-map-svg > g').getScreenCTM();
            return [m.a * x + m.c * z + m.e, m.b * x + m.d * z + m.f];
          },
          [x, z],
        );
      const [fx, fy] = await screenOf(foot);
      await page.mouse.click(fx, fy);
      if ((await page.locator('.walk-map-large').count()) > 0) {
        // Not free there: the first tread itself.
        const [tx, ty] = await screenOf(first);
        await page.mouse.click(tx, ty);
      }
      const placed = await figure();
      check(
        'a tap on the enlarged map puts the figure at the stair',
        moved(placed, { x: foot[0], z: foot[1] }) < 0.5 ||
          moved(placed, { x: first[0], z: first[1] }) < 0.5,
        `${placed.x.toFixed(2)}, ${placed.z.toFixed(2)}`,
      );
      /** Steers with the pad towards a plan point until it is reached (closed loop: slow frames). */
      const steer = async ([tx, tz], reach = 0.2) => {
        const box = await page.locator('.joystick').boundingBox();
        const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        const deadline = Date.now() + 25_000;
        while (Date.now() < deadline) {
          const f = await figure();
          const [dx, dz] = [tx - f.x, tz - f.z];
          const distance = Math.hypot(dx, dz);
          if (distance < reach) break;
          let diff = Math.atan2(-dx, -dz) - f.yaw;
          diff = ((((diff + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
          // Left on the pad turns left (yaw grows); push up only when roughly facing the point.
          const kx = Math.max(-44, Math.min(44, -diff * 50));
          const ky = Math.abs(diff) < 0.35 ? -Math.min(36, 8 + distance * 60) : 0;
          await page.mouse.move(cx + kx, cy + ky);
          await page.waitForTimeout(150);
        }
        await page.mouse.move(cx, cy);
        await page.mouse.up();
      };
      const last = stair.centres.at(-1);
      const before = stair.centres.at(-2) ?? first;
      const beyond = [last[0] + (last[0] - before[0]) * 3, last[1] + (last[1] - before[1]) * 3];
      for (const point of [...stair.centres, beyond]) {
        await steer(point);
        if ((await figure()).level === stair.to) break;
      }
      await page.waitForTimeout(600);
      const top = await figure();
      check(
        'the pad walks the figure up the stair',
        top.level === stair.to,
        `${start.level} -> ${top.level}`,
      );
      check(
        'the minimap switches level on the stair and keeps tracking the figure',
        await mapMatches(),
        JSON.stringify(await onMap()),
      );
      await page.screenshot({ path: out.replace(/\.png$/, '-stair.png') });
    }
    console.log(`end ${JSON.stringify(await figure())} in "${await where()}"`);
    // Leaving walk mode logs nothing, whichever way in: the first-person walk above, the overview
    // opened by address, and a walk restored after a reload (issue #31: a removeChild page error
    // when the room names change as the overview is left).
    const exit = async (label) => {
      const before = errors.length;
      await page.getByRole('button', { name: /Exit/ }).click();
      await hud.waitFor({ state: 'detached', timeout: 30_000 });
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
    await page.reload({ waitUntil: 'networkidle', timeout: 60_000 });
    await hud.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(3000);
    await exit('a walk restored after a reload');

    // Wall and ceiling pieces never block the figure: a wall cabinet and a downlight right in its
    // path, answered inside the browser (nothing is written), let it walk on; the same cabinet
    // standing on the floor stops it (so the pieces were really there).
    const inPath = async (mounting) => {
      await open('/?walk=first');
      const from = await figure();
      // Forward on the plan for a yaw (as `steer` above): (-sin yaw, -cos yaw).
      const [dx, dz] = [-Math.sin(from.yaw), -Math.cos(from.yaw)];
      const at = (d) => ({ x: from.x + dx * d, z: from.z + dz * d });
      const now = new Date().toISOString();
      const piece = (id, typeId, position, mount, elevation) => ({
        id,
        homeId: '',
        typeId,
        name: `Smoke · ${id}`,
        levelId: from.level,
        roomId: null,
        position,
        // Its front (local +z) along the walk, so its width lies across the path.
        rotationY: Math.atan2(dx, dz),
        mounting: mount,
        elevation,
        params: {},
        version: 1,
        createdAt: now,
        updatedAt: now,
        removedAt: null,
        purgeAt: null,
      });
      await page.route(/\/api\/homes\/[^/]+\/placements(\?|$)/, async (route) => {
        if (route.request().method() !== 'GET') return route.abort();
        const response = await route.fetch({
          headers: { ...route.request().headers(), authorization: `Bearer ${token}` },
        });
        const body = await response.json();
        const homeId = new URL(route.request().url()).pathname.split('/')[3];
        const extra = [
          piece(
            'smoke-wall-cabinet',
            'kitchen.wall-cabinet',
            at(0.6),
            mounting,
            mounting === 'wall' ? 1.33 : 0,
          ),
          piece('smoke-downlight', 'fixture.downlight', at(0.8), 'ceiling', 0),
        ].map((p) => ({ ...p, homeId }));
        return route.fulfill({ response, json: { items: [...body.items, ...extra] } });
      });
      await page.reload({ waitUntil: 'networkidle', timeout: 60_000 });
      await hud.waitFor({ timeout: 30_000 });
      await page.waitForTimeout(3000);
      const restored = await figure();
      const box = await page.locator('.joystick').boundingBox();
      const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy - 44, { steps: 5 });
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && moved(await figure(), restored) < 1.2) {
        await page.waitForTimeout(250);
      }
      await page.mouse.up();
      await page.waitForTimeout(500);
      const distance = moved(await figure(), restored);
      await page.unroute(/\/api\/homes\/[^/]+\/placements(\?|$)/);
      await exit(`the walk past a ${mounting} cabinet`);
      return { distance, restored: moved(restored, from) };
    };
    const blocked = await inPath('floor');
    const under = await inPath('wall');
    check(
      'a cabinet standing on the floor in its path stops the figure',
      blocked.distance < 0.3 && blocked.restored < 0.05,
      `${blocked.distance.toFixed(2)} m`,
    );
    check(
      'the figure walks under a wall cabinet and a downlight in its path',
      under.distance > 0.9 && under.restored < 0.05,
      `${under.distance.toFixed(2)} m`,
    );
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
