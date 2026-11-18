// Run by mobile-smoke.sh; not meant to be called directly.
//   node mobile-smoke.mjs <out.png> [home-id]   (SITE_BASE, SITE_TOKEN from with-site-token.sh)
// Smoke test of the phone layout on a touch screen: the top bar, the sheet with its panels, the level
// switcher, furniture (every placement write answered inside the browser), walk mode, and the side
// sheet with the phone held across. Read-only: nothing is written to the environment.
// Playwright is loaded from MY_HOME_PLAYWRIGHT_DIR.
/* global document, window, WebGL2RenderingContext */
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

const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };
/** Smallest comfortable touch target, in CSS pixels. */
const TOUCH = 44;

/** Whether two boxes share any area (a pixel of rounding is not an overlap). */
const overlap = (a, b) =>
  a.x < b.x + b.width - 1 &&
  b.x < a.x + a.width - 1 &&
  a.y < b.y + b.height - 1 &&
  b.y < a.y + a.height - 1;

async function smoke(out, homeId) {
  const base = process.env.SITE_BASE;
  const host = new URL(base).host;
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  let page;
  const blocked = [];
  /**
   * The furniture this run placed, answered inside the browser: the environment never sees a
   * placement write. Reads of the placements get these merged in, as if they were stored.
   */
  const fake = new Map();
  let answered = 0;
  const now = () => new Date().toISOString();
  const active = () => [...fake.values()].filter((p) => p.removedAt === null);
  const target = homeId ? `/?home=${encodeURIComponent(homeId)}` : '/';
  try {
    // A phone held upright, with a touch screen.
    const context = await browser.newContext({
      viewport: PORTRAIT,
      hasTouch: true,
      isMobile: true,
      // A phone's screen is finer than this; 2 is enough to see that the canvas stops at 1.5.
      deviceScaleFactor: 2,
    });
    // Counts what the page draws with WebGL, to tell a view at rest from one that keeps rendering.
    await context.addInitScript(() => {
      window.__draws = 0;
      for (const name of [
        'drawElements',
        'drawArrays',
        'drawElementsInstanced',
        'drawArraysInstanced',
      ]) {
        const original = WebGL2RenderingContext.prototype[name];
        WebGL2RenderingContext.prototype[name] = function (...args) {
          window.__draws++;
          return original.apply(this, args);
        };
      }
    });
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.host !== host) return route.continue();
      const method = request.method();
      const headers = { ...request.headers(), authorization: `Bearer ${token}` };
      const json = (status, body) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      const placements = /^\/api\/homes\/([^/]+)\/placements(?:\/([^/]+)(\/restore)?)?$/.exec(
        url.pathname,
      );
      // Reads are free; the placement list gets this run's furniture merged in.
      if (method === 'GET' || method === 'HEAD') {
        if (!placements || placements[2]) return route.continue({ headers });
        const response = await route.fetch({ headers });
        const body = await response.json();
        return json(response.status(), { items: [...body.items, ...fake.values()] });
      }
      // Placement writes: answered here with what the api would answer, never sent.
      if (placements) {
        answered++;
        const homeId = decodeURIComponent(placements[1]);
        const id = placements[2] && decodeURIComponent(placements[2]);
        const current = id && fake.get(id);
        if (!id && method === 'POST') {
          const body = request.postDataJSON();
          const n = fake.size + 1;
          const created = {
            id: `mobile-smoke-${n}`,
            homeId,
            typeId: body.typeId,
            name: body.name ?? `Mobile smoke · ${n}`,
            levelId: body.levelId,
            roomId: null,
            position: body.position,
            rotationY: body.rotationY ?? 0,
            params: body.params ?? {},
            version: 1,
            createdAt: now(),
            updatedAt: now(),
            removedAt: null,
            purgeAt: null,
          };
          fake.set(created.id, created);
          return json(201, created);
        }
        if (!current) {
          // Not this run's: a real placement is never changed.
          blocked.push(`${method} ${url.pathname}`);
          return route.abort();
        }
        const removed = method === 'DELETE';
        const patch =
          method === 'PATCH'
            ? { ...request.postDataJSON() }
            : { removedAt: removed ? now() : null };
        delete patch.version;
        const next = { ...current, ...patch, version: current.version + 1, updatedAt: now() };
        fake.set(id, next);
        return json(200, next);
      }
      // Anything else (photos, requests, settings, the home) is refused here.
      blocked.push(`${method} ${url.pathname}`);
      return route.abort();
    });
    page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });

    await page.goto(new URL(target, base).href, { waitUntil: 'networkidle', timeout: 60_000 });
    if (new URL(page.url()).host !== host)
      throw new Error('ended on another host (login redirect?)');
    await page.waitForSelector('canvas', { timeout: 30_000 });
    const sheet = page.locator('.sheet');
    await sheet.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(3000);

    const box = (selector) => page.locator(selector).first().boundingBox();
    const snap = async () =>
      /sheet-(collapsed|half|full)/.exec(await sheet.getAttribute('class'))?.[1];
    const tab = (name) => page.getByRole('tab', { name });
    const settle = () => page.waitForTimeout(600);
    // Real touch events, as a finger makes them.
    const finger = await context.newCDPSession(page);
    const touch = (type, x, y) =>
      finger.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }],
      });

    // First-run hints: there on a fresh phone, gone after "Got it".
    const hints = page.getByRole('complementary', { name: 'How to use the viewer' });
    check('the first-run hints show', await hints.isVisible());
    await hints.getByRole('button', { name: 'Got it' }).tap();
    await settle();
    check('"Got it" dismisses the hints', (await hints.count()) === 0);

    // The default view: everything but the top bar and the tab bar belongs to the 3D view.
    check(
      'the phone layout is used',
      (await page.locator('.viewer.mobile.portrait').count()) === 1,
    );
    check('the sheet starts collapsed', (await snap()) === 'collapsed');
    const [bar, canvas, tabs, rose] = [
      await box('.topbar'),
      await box('canvas'),
      await box('.sheet'),
      await box('.compass'),
    ];
    check(
      'the 3D view takes most of the screen',
      canvas.height > PORTRAIT.height * 0.7,
      `${Math.round(canvas.height)} of ${PORTRAIT.height} px`,
    );
    check(
      'the 3D view is not under the top bar or the sheet',
      !overlap(canvas, bar) && !overlap(canvas, tabs),
    );
    check(
      'the compass is on the 3D view, clear of the bars',
      !overlap(rose, bar) && !overlap(rose, tabs),
    );
    const reset = await box('.reset-view');
    check(
      '"Reset view" is on the 3D view, clear of the bars and the compass',
      reset !== null && !overlap(reset, bar) && !overlap(reset, tabs) && !overlap(reset, rose),
    );
    const width = await page.evaluate(() => document.scrollingElement.scrollWidth);
    check('nothing is wider than the screen', width <= PORTRAIT.width, `${width} px`);
    const small = await page
      .locator('.topbar button, .topbar select, .sheet-bar button, .reset-view')
      .evaluateAll(
        (elements, min) =>
          elements
            .map((e) => ({
              name: e.getAttribute('aria-label') ?? e.textContent,
              box: e.getBoundingClientRect(),
            }))
            .filter((e) => e.box.width < min || e.box.height < min)
            .map((e) => `${e.name.trim()} ${Math.round(e.box.width)}x${Math.round(e.box.height)}`),
        TOUCH,
      );
    check(
      `top bar and tab bar controls are at least ${TOUCH} px`,
      small.length === 0,
      small.join(', '),
    );

    // Every control says what it is, to a screen reader as well.
    const unnamed = () =>
      page
        .locator('button, select, input:not([type=hidden]), textarea, [role=tab], [role=radio]')
        .evaluateAll((controls) =>
          controls
            .filter((c) => c.getClientRects().length > 0)
            .filter(
              (c) =>
                !(
                  c.getAttribute('aria-label') ||
                  c.labels?.[0]?.textContent.trim() ||
                  c.textContent.trim() ||
                  c.title
                ),
            )
            .map((c) => c.outerHTML.slice(0, 80)),
        );
    const named = async (where) => {
      const list = await unnamed();
      check(`every control ${where} has a name`, list.length === 0, list.slice(0, 3).join(' | '));
    };
    await named('of the default view');

    // At rest nothing is drawn: the phone renders a frame only when something changed.
    const draws = () => page.evaluate(() => window.__draws);
    await page.waitForTimeout(3000);
    const resting = await draws();
    await page.waitForTimeout(2000);
    const idle = (await draws()) - resting;
    check('the 3D view rests when nothing moves', idle === 0, `${idle} draw calls in 2 s`);
    // One finger turns the view, and "Reset view" puts it back: both are drawn.
    const middle = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
    await touch('touchStart', middle.x, middle.y);
    for (let step = 1; step <= 5; step++) await touch('touchMove', middle.x + step * 12, middle.y);
    await touch('touchEnd');
    await page.waitForTimeout(1500);
    const orbited = (await draws()) - resting - idle;
    check('turning the view with a finger draws it', orbited > 0, `${orbited} draw calls`);
    await page.getByRole('button', { name: /Reset view/ }).tap();
    await page.waitForTimeout(3000);
    const back = (await draws()) - resting - idle - orbited;
    check('"Reset view" draws it again', back > 0, `${back} draw calls`);
    // "Reset view" also drops what is left of the swipe's easing (it would turn the view away again
    // and draw a hundred more frames, half a minute under software rendering): all is still at once.
    let calm = await draws();
    let rested = false;
    for (let tries = 0; tries < 3 && !rested; tries++) {
      await page.waitForTimeout(2000);
      const now = await draws();
      rested = now === calm;
      calm = now;
    }
    check('and it comes to rest again', rested);
    const ratio = await page.locator('canvas').evaluate((c) => c.width / c.clientWidth);
    check(
      'the canvas is not drawn finer than 1.5 device pixels',
      ratio <= 1.5 + 0.01,
      ratio.toFixed(2),
    );

    // Installable: the manifest and its icons answer, with the session's credentials.
    const app = await page.evaluate(async () => {
      const link = document.querySelector('link[rel=manifest]');
      if (!link) return { link: false };
      const response = await fetch(link.href, { credentials: 'include' });
      const manifest = response.ok ? await response.json() : {};
      const icons = [];
      for (const icon of manifest.icons ?? [])
        icons.push((await fetch(new URL(icon.src, link.href), { credentials: 'include' })).status);
      return {
        link: true,
        credentials: link.crossOrigin,
        status: response.status,
        type: response.headers.get('content-type'),
        display: manifest.display,
        icons,
      };
    });
    check(
      'the web app manifest is served and asks for a standalone window',
      app.link && app.status === 200 && app.display === 'standalone',
      JSON.stringify(app),
    );
    check(
      'the manifest is fetched with credentials (the site is behind a sign-on)',
      app.credentials === 'use-credentials',
    );
    check(
      'its icons are served',
      app.icons?.length >= 3 && app.icons.every((status) => status === 200),
    );

    // The sheet: one tap opens a panel, one tap closes it.
    await tab(/View/).tap();
    await settle();
    check('a tap on a tab opens its panel', (await snap()) === 'half');
    check(
      'the View panel shows',
      await page.getByRole('region', { name: 'View controls' }).isVisible(),
    );
    await named('of the View panel');
    const half = await box('canvas');
    check(
      'the 3D view ends where the open sheet begins',
      !overlap(half, await box('.sheet')) && half.height < canvas.height,
    );
    await tab(/View/).tap();
    await settle();
    check('a tap on the open tab closes it', (await snap()) === 'collapsed');
    await page.getByRole('button', { name: 'Open the panel' }).tap();
    await settle();
    await page.getByRole('button', { name: 'Make the panel larger' }).tap();
    await settle();
    check('the sheet opens to the full height', (await snap()) === 'full');
    await page.getByRole('button', { name: 'Close the panel' }).tap();
    await settle();
    check('the arrow closes the sheet', (await snap()) === 'collapsed');

    // The level switcher in the top bar.
    const levels = page.getByRole('radiogroup', { name: 'Show up to level' }).getByRole('radio');
    const lowest = levels.last();
    const lowestName = await lowest.getAttribute('aria-label');
    await lowest.tap();
    await page.waitForTimeout(1500);
    check(
      `the level switches to "${lowestName}"`,
      (await lowest.getAttribute('aria-checked')) === 'true',
    );
    check(
      'room names show once the building is cut away',
      (await page.locator('.room-label').count()) > 0,
    );

    // Furniture: the home's one placement set, with no layout manager.
    await tab(/Furniture/).tap();
    await settle();
    const furniture = page.getByRole('region', { name: 'Furniture' });
    check('the Furniture panel shows', await furniture.isVisible());
    await named('of the Furniture panel');
    check(
      'there is no layout manager',
      (await furniture.getByRole('group', { name: 'Layout' }).count()) === 0 &&
        (await furniture.getByRole('button', { name: 'New', exact: true }).count()) === 0,
    );
    const saved = () => furniture.getByRole('status').filter({ hasText: 'All changes saved' });
    await saved().waitFor({ timeout: 20_000 });
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/api\/homes\/[^/]+\/placements$/.test(new URL(response.url()).pathname),
      { timeout: 20_000 },
    );
    // A piece with a solid top (not a bed, whose top is mostly air above the mattress): the touch
    // further down aims at the middle of the item's top.
    const catalog = furniture.locator('.catalog-item');
    const solid = catalog.filter({ hasText: /wardrobe|desk|table/i });
    await ((await solid.count()) > 0 ? solid : catalog).first().tap();
    await furniture.getByLabel('Selected item').waitFor({ timeout: 10_000 });
    check('a tap in the catalog places an item and selects it', true);
    check('the placement is saved', (await created).ok());
    await saved().waitFor({ timeout: 20_000 });
    check('the item is saved as one placement', active().length === 1, `${active().length}`);
    check(
      'it gets the id the server gave it',
      (await furniture.getByLabel('Selected item').textContent()).includes('Mobile smoke · 1'),
    );

    // Editing by touch with the panel closed: the item's tools float next to it.
    await page.getByRole('button', { name: 'Close the panel' }).tap();
    await settle();
    const toolbar = page.locator('.item-toolbar');
    await toolbar.waitFor({ timeout: 10_000 });
    const view = await box('canvas');
    const tools = await toolbar.boundingBox();
    check(
      'the selected item has a floating toolbar inside the 3D view',
      tools.x >= view.x &&
        tools.x + tools.width <= view.x + view.width + 1 &&
        tools.y >= view.y &&
        tools.y + tools.height <= view.y + view.height + 1,
    );
    const smallTools = await toolbar
      .locator('button')
      .evaluateAll(
        (buttons, min) =>
          buttons.filter((b) => b.offsetWidth < min || b.offsetHeight < min).map((b) => b.title),
        TOUCH,
      );
    check(`its buttons are at least ${TOUCH} px`, smallTools.length === 0, smallTools.join(', '));

    const items = async () => active();
    /** The stored items once `done` holds for them (the app saves a moment after an edit). */
    const until = async (done) => {
      const deadline = Date.now() + 20_000;
      for (;;) {
        const list = await items();
        if (done(list) || Date.now() > deadline) return list;
        await page.waitForTimeout(500);
      }
    };
    /**
     * A point on the selected item: the toolbar floats 44 px above the middle of the item's top.
     * From far away an item is only a few pixels, so aim at that middle.
     */
    const onItem = async () => {
      const at = await toolbar.boundingBox();
      return { x: at.x + at.width / 2, y: at.y + at.height / 2 + 44 + 1 };
    };

    const [placed] = await items();
    const from = await onItem();
    // A drag leaves the spot at once (a finger that rests there is a long press): the press and
    // the first moves go out together, without waiting for the slow software renderer in between.
    void touch('touchStart', from.x, from.y);
    const dragStep = { x: 7, y: 4 };
    const dragSteps = 8;
    /** Where the finger let go: the item followed it there. */
    const dropped = { x: from.x + dragSteps * dragStep.x, y: from.y + dragSteps * dragStep.y };
    void touch('touchMove', from.x + dragStep.x, from.y + dragStep.y);
    for (let step = 2; step <= dragSteps; step++) {
      await touch('touchMove', from.x + step * dragStep.x, from.y + step * dragStep.y);
      await page.waitForTimeout(80);
    }
    await touch('touchEnd');
    const distance = (a, b) => Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
    const [moved] = await until((list) => distance(list[0], placed) > 0.05);
    check(
      'dragging the item with a finger moves it',
      distance(moved, placed) > 0.05,
      `${distance(moved, placed).toFixed(2)} m`,
    );

    await toolbar.getByRole('button', { name: 'Rotate left' }).tap();
    const [turned] = await until((list) => list[0].rotationY !== moved.rotationY);
    check('the toolbar rotates it', turned.rotationY !== moved.rotationY);

    // A long press is "more": the furniture panel opens on the item, which stays where it is.
    // Pressed where the drag ended: the item followed the finger there. (The toolbar is no guide
    // here: near the edge of the view it is pushed back inside, away from the item.) The finger
    // stays down until the panel opens, however slow the renderer is, then lets go.
    await touch('touchStart', dropped.x, dropped.y);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && (await snap()) !== 'half') await page.waitForTimeout(100);
    await touch('touchEnd');
    await settle();
    check(
      'a long press opens the furniture panel on the item',
      (await snap()) === 'half' && (await furniture.getByLabel('Selected item').isVisible()),
    );
    await page.waitForTimeout(1500);
    const [stayed] = await items();
    check('the long press does not move it', distance(stayed, turned) < 0.01);

    await toolbar.getByRole('button', { name: 'Duplicate' }).tap();
    check('the toolbar duplicates it', (await until((list) => list.length === 2)).length === 2);
    await toolbar.getByRole('button', { name: 'Delete' }).tap();
    check('the toolbar deletes the copy', (await until((list) => list.length === 1)).length === 1);
    check('without a selection the toolbar is gone', (await toolbar.count()) === 0);

    // Walk mode takes the whole screen and gives it back.
    await page.getByRole('button', { name: 'Walk and take photos' }).tap();
    await page.locator('[data-testid=walk-hud]').waitFor({ timeout: 20_000 });
    check(
      'walking hides the top bar and the sheet',
      (await page.locator('.topbar').count()) === 0 && (await sheet.count()) === 0,
    );
    check('the movement pad is there', await page.locator('.joystick').isVisible());
    await page.getByRole('button', { name: /Exit/ }).tap();
    await sheet.waitFor({ timeout: 20_000 });
    check(
      'leaving walk mode brings the panel back',
      (await snap()) === 'half' && (await furniture.isVisible()),
    );

    // Held across: the sheet is at the side and the view keeps most of the width.
    await page.setViewportSize(LANDSCAPE);
    await page.waitForTimeout(1500);
    check(
      'held across, the sheet is at the side',
      (await page.locator('.sheet.sheet-side').count()) === 1,
    );
    const side = await box('.sheet');
    const wide = await box('canvas');
    check(
      'the 3D view keeps most of the width beside the open sheet',
      !overlap(wide, side) && wide.width > LANDSCAPE.width * 0.5,
      `${Math.round(wide.width)} of ${LANDSCAPE.width} px`,
    );
    await page.getByRole('button', { name: 'Close the panel' }).tap();
    await settle();
    const rail = await box('.sheet');
    check(
      'collapsed, the side sheet is a narrow rail',
      rail.width <= 96,
      `${Math.round(rail.width)} px`,
    );
    await page.screenshot({ path: out.replace(/\.png$/, '-landscape.png') });
    await page.setViewportSize(PORTRAIT);
    await page.waitForTimeout(1500);

    await tab(/Furniture/).tap();
    await settle();
    await page.screenshot({ path: out });
    check(
      'no console or page errors',
      errors.length === 0,
      errors.slice(0, 5).map(redact).join(' | '),
    );
    check(
      'every placement write was answered in the browser',
      answered >= 5,
      `${answered} answered`,
    );
    check('nothing was written', blocked.length === 0, blocked.join(', '));
    console.log(`screenshot ${out}`);
  } finally {
    await browser.close();
  }
}

smoke(process.argv[2], process.argv[3]).then(
  () => {
    console.log(failures.length ? `FAILED: ${failures.join('; ')}` : 'mobile smoke test passed');
    process.exit(failures.length ? 1 : 0);
  },
  (error) => {
    console.error(`FAILED: ${redact(error.message)}`);
    process.exit(1);
  },
);
