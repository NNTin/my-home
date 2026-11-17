// Run by mobile-smoke.sh; not meant to be called directly.
//   node mobile-smoke.mjs <out.png> [home-id]   (SITE_BASE, SITE_TOKEN from with-site-token.sh)
// Smoke test of the phone layout on a touch screen: the top bar, the sheet with its panels, the level
// switcher, furniture in a layout of its own, walk mode, and the side sheet with the phone held across.
// Playwright is loaded from MY_HOME_PLAYWRIGHT_DIR.
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
  /** The layout this run created: the only thing it may change, and it removes it again. */
  let ownLayout;
  let page;
  const blocked = [];
  const target = homeId ? `/?home=${encodeURIComponent(homeId)}` : '/';
  try {
    // A phone held upright, with a touch screen.
    const context = await browser.newContext({
      viewport: PORTRAIT,
      hasTouch: true,
      isMobile: true,
    });
    await context.route('**/*', (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.host !== host) return route.continue();
      // Reads are free. Writes: creating a layout, and saving or removing the layout this run
      // created. Anything else (photos, requests, other layouts, the home) is refused here.
      const method = request.method();
      const write = method !== 'GET' && method !== 'HEAD';
      const allowed =
        (method === 'POST' && /^\/api\/homes\/[^/]+\/layouts$/.test(url.pathname)) ||
        (ownLayout !== undefined && url.pathname === `/api/layouts/${ownLayout}`);
      if (write && !allowed) {
        blocked.push(`${method} ${url.pathname}`);
        return route.abort();
      }
      return route.continue({
        headers: { ...request.headers(), authorization: `Bearer ${token}` },
      });
    });
    page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    // "Delete layout ...?" for the layout of this run.
    page.on('dialog', (dialog) => void dialog.accept());

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

    // The sheet: one tap opens a panel, one tap closes it.
    await tab(/View/).tap();
    await settle();
    check('a tap on a tab opens its panel', (await snap()) === 'half');
    check(
      'the View panel shows',
      await page.getByRole('region', { name: 'View controls' }).isVisible(),
    );
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

    // Furniture, in a layout of this run's own.
    await tab(/Furniture/).tap();
    await settle();
    const furniture = page.getByRole('region', { name: 'Furniture' });
    check('the Furniture panel shows', await furniture.isVisible());
    const saved = () => furniture.getByRole('status').filter({ hasText: 'All changes saved' });
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/api\/homes\/[^/]+\/layouts$/.test(new URL(response.url()).pathname),
      { timeout: 20_000 },
    );
    await furniture.getByRole('button', { name: 'New', exact: true }).tap();
    ownLayout = (await (await created).json()).id;
    check('a layout of its own was created', typeof ownLayout === 'string');
    await saved().waitFor({ timeout: 20_000 });
    // The edit is saved a moment later: wait for that request, not for the status text before it.
    const save = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname === `/api/layouts/${ownLayout}`,
      { timeout: 20_000 },
    );
    // A piece with a solid top (not a bed, whose top is mostly air above the mattress): the touch
    // further down aims at the middle of the item's top.
    const catalog = furniture.locator('.catalog-item');
    const solid = catalog.filter({ hasText: /wardrobe|desk|table/i });
    await ((await solid.count()) > 0 ? solid : catalog).first().tap();
    await furniture.getByLabel('Selected item').waitFor({ timeout: 10_000 });
    check('a tap in the catalog places an item and selects it', true);
    check('the layout is saved', (await save).ok());
    await saved().waitFor({ timeout: 20_000 });
    const stored = await page.evaluate(
      async (id) => (await (await fetch(`/api/layouts/${id}`)).json()).items.length,
      ownLayout,
    );
    check('the item is saved in the layout', stored === 1, `${stored} item(s)`);

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

    const items = () =>
      page.evaluate(
        async (id) => (await (await fetch(`/api/layouts/${id}`)).json()).items,
        ownLayout,
      );
    /** The stored items once `done` holds for them (the app saves a moment after an edit). */
    const until = async (done) => {
      const deadline = Date.now() + 20_000;
      for (;;) {
        const list = await items();
        if (done(list) || Date.now() > deadline) return list;
        await page.waitForTimeout(500);
      }
    };
    // Real touch events, as a finger makes them.
    const finger = await context.newCDPSession(page);
    const touch = (type, x, y) =>
      finger.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }],
      });
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
    void touch('touchMove', from.x + 7, from.y + 4);
    for (let step = 2; step <= 8; step++) {
      await touch('touchMove', from.x + step * 7, from.y + step * 4);
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
    const held = await onItem();
    await touch('touchStart', held.x, held.y);
    await page.waitForTimeout(1000);
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

    // Clean up: remove the layout of this run through the app.
    await tab(/Furniture/).tap();
    await settle();
    await page.screenshot({ path: out });
    await removeOwnLayout(page, ownLayout);
    check(
      'no console or page errors',
      errors.length === 0,
      errors.slice(0, 5).map(redact).join(' | '),
    );
    // Asking for the removed layout logs a 404 in the console, so this comes after the check above.
    const left = await page.evaluate(
      async (id) => (await fetch(`/api/layouts/${id}`)).status,
      ownLayout,
    );
    check('its layout is removed again', left === 404, `GET answers ${left}`);
    if (left === 404) ownLayout = undefined;
    check('nothing but its own layout was written', blocked.length === 0, blocked.join(', '));
    console.log(`screenshot ${out}`);
  } finally {
    // A run that stopped half-way still removes its layout: open the panel afresh and delete it.
    if (ownLayout !== undefined && page) {
      const id = ownLayout;
      const gone = await (async () => {
        const fresh = `${target}${target.includes('?') ? '&' : '?'}panel=furniture&sheet=full&hints=off`;
        await page.setViewportSize(PORTRAIT);
        await page.goto(new URL(fresh, base).href, { waitUntil: 'networkidle', timeout: 60_000 });
        await page.getByRole('region', { name: 'Furniture' }).waitFor({ timeout: 30_000 });
        await page.waitForTimeout(2000);
        await removeOwnLayout(page, id);
        return page.evaluate(async (layout) => (await fetch(`/api/layouts/${layout}`)).status, id);
      })().catch(() => undefined);
      if (gone === 404) ownLayout = undefined;
    }
    if (ownLayout !== undefined)
      console.log(`LEFT BEHIND: layout ${ownLayout} could not be removed; remove it in the app`);
    await browser.close();
  }
}

/** Removes the layout with the app's own Delete button, after making sure it is the open one. */
async function removeOwnLayout(page, id) {
  const furniture = page.getByRole('region', { name: 'Furniture' });
  // The first field of the panel: which layout is open.
  const select = furniture.locator('select').first();
  if ((await select.inputValue()) !== id) await select.selectOption(id);
  await page.waitForTimeout(1000);
  if ((await select.inputValue()) !== id) return;
  const removed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/layouts/${id}` && response.status() === 204,
    { timeout: 20_000 },
  );
  await furniture.getByRole('button', { name: 'Delete', exact: true }).first().tap();
  await removed.catch(() => {});
  await page.waitForTimeout(1500);
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
