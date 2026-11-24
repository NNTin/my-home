// Run by mobile-smoke.sh; not meant to be called directly.
//   node mobile-smoke.mjs <out.png> [home-id]   (SITE_BASE, SITE_TOKEN from with-site-token.sh)
// Smoke test of the phone layout on a touch screen: the top bar, the sheet with its panels, the level
// switcher, furniture (every placement write answered inside the browser), walk mode, and the side
// sheet with the phone held across. Then the frame loop, on a phone and on a desktop: the draw calls of a
// moving frame against the budgets, and nothing drawn while idle in every value of the quality setting.
// Read-only: nothing is written to the environment.
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
/** The widest the collapsed side sheet may be (it is 72 px plus the safe area), in CSS pixels. */
const RAIL_MAX = 96;

/**
 * How long a screenshot may take. The browser draws in software here: a frame of the lit scene
 * takes seconds, and a shot waits until the frames before it are drawn.
 */
const SHOT_TIMEOUT_MS = 180_000;
/**
 * Draw calls of one moving frame (docs/design/realistic-render.md §10.1): the first view, then the
 * whole house.
 */
const DRAW_CALLS = { phone: [250, 350], desktop: [350, 500] };
/** The lamp pool and the lights that cast shadows (the sun, and 4 lamps on a desktop). */
const LAMPS = { phone: [6, 1], desktop: [12, 5] };
const QUALITIES = ['fast', 'auto', 'beautiful'];

/** Counts what a page draws with WebGL, to tell a view at rest from one that keeps rendering. */
function countDraws() {
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
}

/**
 * The frame loop on one kind of device, in a context of its own: for every value of the quality
 * setting the view settles and then draws nothing; a moving frame of the first view and of the whole
 * house stays within the draw-call budget. Read-only: only GET requests leave the browser.
 */
async function frameChecks(browser, { device, base, host, homeId }) {
  const phone = device === 'phone';
  const context = await browser.newContext(
    phone
      ? { viewport: PORTRAIT, hasTouch: true, isMobile: true, deviceScaleFactor: 2, ...CLIPBOARD }
      : { viewport: { width: 1440, height: 900 }, ...CLIPBOARD },
  );
  await context.addInitScript(countDraws);
  await context.route('**/*', (route) => {
    const request = route.request();
    if (new URL(request.url()).host !== host) return route.continue();
    if (!['GET', 'HEAD'].includes(request.method())) return route.abort();
    return route.continue({ headers: { ...request.headers(), authorization: `Bearer ${token}` } });
  });
  const page = await context.newPage();
  const draws = () => page.evaluate(() => window.__draws);
  const perf = () => page.evaluate(() => window.__myHomePerf?.());
  /** Waits for the settled frame, in `tier` when one is named. */
  const settled = (tier) =>
    page
      .waitForSelector(`canvas[data-frame="settled"]${tier ? `[data-tier="${tier}"]` : ''}`, {
        timeout: 240_000,
      })
      .then(
        () => true,
        () => false,
      );
  /** One step of the mouse wheel or a short pinch-free swipe: a few moving frames. */
  const nudge = async () => {
    const canvas = await page.locator('canvas').first().boundingBox();
    const x = canvas.x + canvas.width / 2;
    const y = canvas.y + canvas.height * 0.4;
    if (phone) {
      const finger = await context.newCDPSession(page);
      const touch = (type, dx = 0) =>
        finger.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x + dx), y: Math.round(y) }],
        });
      await touch('touchStart');
      for (let step = 1; step <= 4; step++) await touch('touchMove', step * 10);
      await touch('touchEnd');
    } else {
      await page.mouse.move(x, y);
      await page.mouse.wheel(0, 120);
    }
    await page.waitForTimeout(1500);
  };
  try {
    for (const quality of QUALITIES) {
      // Stepping down is off: a software renderer is slow, and the tier asked for must be drawn.
      const query = new URLSearchParams({ quality, perf: '1', hints: 'off', stepdown: 'off' });
      if (homeId) query.set('home', homeId);
      await page.goto(new URL(`/?${query}`, base).href, {
        waitUntil: 'networkidle',
        timeout: 60_000,
      });
      await page.waitForSelector('canvas', { timeout: 30_000 });
      await page.waitForTimeout(1500);
      if ((await page.locator('canvas').first().getAttribute('data-frame')) === null) {
        console.log(`skip  the frame loop on a ${device}: a build before #110 (no data-frame)`);
        return;
      }
      const where = `on a ${device}, quality ${quality}`;
      // A build before the beautiful tier (#111) draws the fast tier in every setting.
      const tiers = (await perf())?.beautifulReady !== undefined;
      const atRest = tiers && quality !== 'fast' ? 'beautiful' : 'fast';
      check(`${where}: the view settles in the ${atRest} tier`, await settled(atRest));
      const before = await draws();
      await page.waitForTimeout(2000);
      const idle = (await draws()) - before;
      const data = await perf();
      check(`${where}: nothing is drawn while idle`, idle === 0, `${idle} draw calls in 2 s`);
      check(
        `${where}: the setting is read from the URL and the ${atRest} tier is on screen`,
        data?.setting === quality &&
          data?.tier === atRest &&
          (await page.locator('canvas').first().getAttribute('data-tier')) === atRest,
        `setting ${data?.setting}, tier ${data?.tier}`,
      );
      if (tiers) {
        // Refine when still (§3.3): `auto` draws one beautiful frame at rest; the others none.
        check(
          `${where}: ${quality === 'auto' ? 'the frame at rest is the refined one' : 'no frame is a refined one'}`,
          quality === 'auto' ? data.refinedFrames >= 1 : data.refinedFrames === 0,
          `${data.refinedFrames} refined frames, the last in ${Math.round(data.refinedFrameMs ?? 0)} ms`,
        );
        check(`${where}: the viewer has not stepped down`, data.steppedDown === undefined);
        // Input: frames while it moves, then rest again. In `auto` those are fast frames and
        // exactly one more refined frame; nothing is drawn afterwards.
        await nudge();
        check(`${where}: the view settles again after input`, await settled(atRest));
        const after = await perf();
        const more = after.frames - data.frames;
        const refined = after.refinedFrames - data.refinedFrames;
        check(
          `${where}: input draws ${quality === 'auto' ? 'fast frames and exactly one refined frame' : `${atRest} frames`}`,
          quality === 'auto' ? refined === 1 && more >= 2 : refined === 0 && more >= 1,
          `${more} frames, ${refined} refined`,
        );
        const rested = await draws();
        await page.waitForTimeout(2000);
        check(`${where}: and nothing is drawn while it rests`, (await draws()) === rested);
        check(
          `${where}: no shader was compiled by those frames`,
          after.compiles === data.compiles && after.programs === data.programs,
          `${data.programs} programs (${data.compiles} compiled), then ${after.programs} (${after.compiles})`,
        );
        if (quality === 'beautiful') await tierSwitch(page, { device, where, perf, settled });
      }
      // Lamps (docs/design/realistic-render.md §6.4, §10.1): a fixed pool per device, and lamp
      // shadows on a desktop only. A build before #111 reports no lamp change at all.
      if (data?.lampChanges === undefined) {
        console.log(`skip  the lamps ${where}: a build before #111 (no lamp pool)`);
      } else {
        const [pool, shadows] = LAMPS[device];
        check(
          `${where}: lamps are lit, at most ${pool}`,
          data.litLamps > 0 && data.litLamps <= pool,
          `${data.litLamps} lit`,
        );
        check(
          `${where}: ${shadows} light${shadows === 1 ? ' casts a shadow, the sun' : 's cast shadows'}`,
          data.shadowLights === shadows,
          `${data.shadowLights} lights with shadows`,
        );
      }
      if (quality !== QUALITIES[0]) continue;

      // The budgets, once: a moving frame of the first view, then of the whole house.
      const [first, whole] = DRAW_CALLS[device];
      await nudge();
      const moving = await perf();
      check(
        `${where}: a moving frame of the first view is within ${first} draw calls`,
        moving.frames > data.frames && moving.drawCalls > 0 && moving.drawCalls <= first,
        `${moving.drawCalls} draw calls, ${moving.triangles} triangles`,
      );
      if (phone) {
        await page
          .getByRole('radiogroup', { name: 'Show up to level' })
          .getByRole('radio')
          .first()
          .tap();
      } else {
        await page.getByRole('group', { name: 'Show up to level' }).getByLabel('Roof').check();
      }
      await page.waitForTimeout(1500);
      await nudge();
      const house = await perf();
      check(
        `${where}: a moving frame of the whole house is within ${whole} draw calls`,
        house.drawCalls > moving.drawCalls && house.drawCalls <= whole,
        `${house.drawCalls} draw calls, ${house.triangles} triangles`,
      );
      check(
        `${where}: no frame compiled a shader after the warm-up`,
        house.compiles === data.compiles,
        `${data.compiles} programs compiled at the start, ${house.compiles} now`,
      );
      check(`${where}: and the view settles again`, await settled());
      const rest = await draws();
      await page.waitForTimeout(2000);
      check(`${where}: nothing is drawn afterwards`, (await draws()) === rest);
      await copyReadout(page, { device, where, draws, perf });
    }
    await lampWalk(page, { device, base, homeId, perf, settled });
  } finally {
    await context.close();
  }
}

/** The readout's "Copy" may read and write the clipboard without a prompt. */
const CLIPBOARD = { permissions: ['clipboard-read', 'clipboard-write'] };

/**
 * One tap or click on "Copy" puts the `?perf=1` readout on the clipboard as a markdown table with
 * its context and this device's budgets, says "Copied", and draws nothing: the view has rested for
 * more than the 3 seconds of "Draw calls, last 3 s", so the copied row itself reads 0. The table is
 * printed: it is what goes into a pull request or an issue.
 */
async function copyReadout(page, { device, where, draws, perf }) {
  const copy = page.locator('.perf-readout').getByRole('button', { name: 'Copy' });
  if ((await copy.count()) === 0) {
    console.log(`skip  ${where}: copying the readout: a build before #123 (no Copy button)`);
    return;
  }
  await page.waitForTimeout(1500);
  const before = { draws: await draws(), frames: (await perf()).frames };
  await (device === 'phone' ? copy.tap() : copy.click());
  await page.waitForTimeout(500);
  const copied = await page
    .locator('.perf-readout')
    .getByRole('button', { name: 'Copied' })
    .count();
  const text = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  const lines = text.trimEnd().split('\n');
  const row = (name) => lines.find((line) => line.startsWith(`| ${name} |`)) ?? '';
  check(
    `${where}: Copy puts the readout on the clipboard as a markdown table and says so`,
    copied === 1 &&
      lines[0] === `| \`?perf=1\` | Measured | Budget (${device}) |` &&
      lines[1] === '| --- | --- | --- |' &&
      // One row more from #112 on: "Texture files".
      lines.length === (row('Texture files') ? 25 : 24) &&
      lines.every((line) => line.startsWith('| ') && line.endsWith(' |')),
    `${lines.length} lines, "${lines[0] ?? ''}"`,
  );
  check(
    `${where}: the copy names the commit, the mode, the viewport and the browser`,
    /^\| Commit \| [0-9a-f]{7} \|/.test(row('Commit')) &&
      /^\| Mode \| orbit, /.test(row('Mode')) &&
      /^\| Viewport \| \d+×\d+, device pixel ratio [\d.]+ \|/.test(row('Viewport')) &&
      /^\| Browser \| Chrome \d+/.test(row('Browser')) &&
      /^\| Time \| \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ \|/.test(row('Time')),
    [row('Commit'), row('Mode'), row('Viewport'), row('Browser')].join(' '),
  );
  const [first, whole] = DRAW_CALLS[device];
  check(
    `${where}: the copy holds the measured values against this device's budgets`,
    row('Draw calls, last frame').endsWith(`| ≤ ${first} first view, ≤ ${whole} whole house |`) &&
      row('Frame, median').endsWith(`| ≤ ${device === 'phone' ? 33 : 17} ms |`),
    row('Draw calls, last frame'),
  );
  await page.waitForTimeout(1500);
  const after = { draws: await draws(), frames: (await perf()).frames };
  check(
    `${where}: copying draws no frame, and the copied idle count is 0`,
    after.draws === before.draws &&
      after.frames === before.frames &&
      row('Draw calls, last 3 s').startsWith('| Draw calls, last 3 s | 0 (0 frames) |'),
    `${after.draws - before.draws} draw calls, ${after.frames - before.frames} frames; ${row('Draw calls, last 3 s')}`,
  );
  console.log(`the readout copied ${where}:\n${text}`);
}

/**
 * Switching tier compiles nothing (§4.5): from `beautiful`, with its lazy chunk loaded and warm,
 * the Quality control chooses fast, then beautiful, then fast again. The canvas shows each tier,
 * and the program count and the compile counter stay what they were.
 */
async function tierSwitch(page, { device, where, perf, settled }) {
  const phone = device === 'phone';
  if (phone) {
    // The control is in the View panel of the sheet.
    await page.getByRole('tab', { name: /View/ }).tap();
    await page.waitForTimeout(800);
  }
  const group = page.getByRole('group', { name: 'Quality' });
  const choose = async (name) => {
    const radio = group.getByLabel(name, { exact: true });
    await radio.scrollIntoViewIfNeeded();
    await (phone ? radio.tap() : radio.check());
  };
  const [fast, beautiful] = phone ? ['Fast', 'Always beautiful'] : ['Fast', 'Beautiful'];
  const start = await perf();
  const seen = [];
  for (const [name, tier] of [
    [fast, 'fast'],
    [beautiful, 'beautiful'],
    [fast, 'fast'],
  ]) {
    await choose(name);
    seen.push((await settled(tier)) ? tier : `not ${tier}`);
  }
  const end = await perf();
  check(
    `${where}: the Quality control switches fast → beautiful → fast`,
    seen.join(' → ') === 'fast → beautiful → fast' && end.frames > start.frames,
    seen.join(' → '),
  );
  check(
    `${where}: the tier switches compiled no shader`,
    end.compiles === start.compiles && end.programs === start.programs,
    `${start.programs} programs (${start.compiles} compiled) before, ${end.programs} (${end.compiles}) after`,
  );
}

/**
 * Walking from room to room moves the lamp pool (§6.4) and compiles nothing (§4.5): the figure
 * walks until a pool light has changed its emitter, and the program count and the compile counter
 * are what they were. A desktop's pool holds every lamp of the home, so only a phone's must move.
 */
async function lampWalk(page, { device, base, homeId, perf, settled }) {
  // In the fast tier: the lamps are the same in every tier (§6.4), and a refined frame at each
  // stop would take the software renderer long enough to hold the figure back.
  const query = new URLSearchParams({ walk: 'first', perf: '1', hints: 'off', quality: 'fast' });
  if (homeId) query.set('home', homeId);
  await page.goto(new URL(`/?${query}`, base).href, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForSelector('canvas', { timeout: 30_000 });
  const where = `on a ${device}, walking`;
  check(`${where}: the view settles`, await settled());
  const start = await perf();
  if (start?.lampChanges === undefined) {
    console.log(`skip  the lamps ${where}: a build before #111 (no lamp pool)`);
    return;
  }
  const [pool, shadows] = LAMPS[device];
  // Forward, and around a corner when a wall stops the figure, until the pool has moved.
  for (const [key, ms] of [
    ['w', 4000],
    ['a', 900],
    ['w', 4000],
    ['a', 900],
    ['w', 4000],
    ['a', 900],
    ['w', 6000],
    ['a', 900],
    ['w', 6000],
  ]) {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    if ((await perf()).lampChanges > start.lampChanges) break;
  }
  check(`${where}: the view settles after the walk`, await settled());
  const now = await perf();
  check(`${where}: frames were drawn`, now.frames > start.frames, `${now.frames - start.frames}`);
  if (device === 'phone')
    check(
      `${where}: the pool moved to other lamps`,
      now.lampChanges > start.lampChanges,
      `${now.lampChanges - start.lampChanges} lights reassigned`,
    );
  check(
    `${where}: no shader was compiled by the walk or a lamp reassignment`,
    now.compiles === start.compiles && now.programs === start.programs,
    `${start.programs} programs (${start.compiles} compiled) before, ${now.programs} (${now.compiles}) after`,
  );
  check(
    `${where}: at most ${pool} lamps are lit and ${shadows} light${shadows === 1 ? ' casts a shadow' : 's cast shadows'}`,
    now.litLamps <= pool && now.shadowLights === shadows,
    `${now.litLamps} lit, ${now.shadowLights} with shadows`,
  );
}

/** Whether two boxes share any area (a pixel of rounding is not an overlap). */
/**
 * Finish textures (docs/design/realistic-render.md §4.4, §4.5, §5.3), in a context of its own
 * whose texture files are held back until the first frames are drawn. Until they arrive the view
 * draws tints and has not settled; a device asks for one size of each set and never the other;
 * and their arrival compiles nothing: the program count and the compile counter stay what they
 * were with the placeholders. Read-only.
 */
async function textureChecks(browser, { device, base, host, homeId }) {
  const phone = device === 'phone';
  const where = `on a ${device}`;
  const context = await browser.newContext(
    phone
      ? { viewport: PORTRAIT, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
      : { viewport: { width: 1440, height: 900 } },
  );
  const requested = [];
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.host !== host) return route.continue();
    if (!['GET', 'HEAD'].includes(request.method())) return route.abort();
    // The files themselves, not a dev server's modules that only name them.
    if (url.pathname.endsWith('.webp') && ['fetch', 'image'].includes(request.resourceType())) {
      requested.push(url.pathname);
      await held;
    }
    return route.continue({ headers: { ...request.headers(), authorization: `Bearer ${token}` } });
  });
  const page = await context.newPage();
  const perf = () => page.evaluate(() => window.__myHomePerf?.());
  try {
    const query = new URLSearchParams({
      quality: 'fast',
      perf: '1',
      hints: 'off',
      stepdown: 'off',
    });
    if (homeId) query.set('home', homeId);
    // Not `networkidle`: the held files are requests that do not end.
    await page.goto(new URL(`/?${query}`, base).href, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForSelector('canvas', { timeout: 30_000 });
    const drawn = await page
      .waitForFunction(() => (window.__myHomePerf?.().frames ?? 0) >= 1, null, { timeout: 240_000 })
      .then(
        () => true,
        () => false,
      );
    await page.waitForTimeout(3000);
    const before = await perf();
    if (before?.textureFiles === undefined) {
      console.log(`skip  finish textures ${where}: a build before #112 (no texture files)`);
      return;
    }
    check(`${where}: the first frames are drawn before any texture has arrived`, drawn);
    check(
      `${where}: textures are asked for, and none has arrived yet`,
      requested.length > 0 && before.textureFiles === 0,
      `${requested.length} requested, ${before.textureFiles} loaded`,
    );
    check(
      `${where}: the view has not settled while textures are on their way`,
      (await page.locator('canvas').first().getAttribute('data-frame')) === 'moving',
    );
    release();
    const settled = await page
      .waitForSelector('canvas[data-frame="settled"]', { timeout: 240_000 })
      .then(
        () => true,
        () => false,
      );
    const after = await perf();
    check(`${where}: the view settles once the textures are here`, settled);
    check(
      `${where}: every texture asked for arrived`,
      after.textureFiles === requested.length && after.textureFailures === 0,
      `${after.textureFiles} of ${requested.length} loaded, ${after.textureFailures} failed`,
    );
    check(
      `${where}: the arrival of the textures compiled no shader`,
      after.compiles === before.compiles && after.programs === before.programs,
      `${before.programs} programs (${before.compiles} compiled) with placeholders, ${after.programs} (${after.compiles}) with textures`,
    );
    const [size, other] = phone ? ['512', '1024'] : ['1024', '512'];
    const sizeOf = (file) => /-(512|1024)[-.]/.exec(file)?.[1];
    check(
      `${where}: one size of each texture set is asked for (${size} px), never the other`,
      requested.every((file) => sizeOf(file) === size) &&
        !requested.some((file) => sizeOf(file) === other) &&
        new Set(requested).size === requested.length,
      requested.filter((file) => sizeOf(file) !== size).join(', '),
    );
    check(
      `${where}: a roughness map is asked for only on a desktop`,
      requested.some((file) => file.includes('roughness')) === !phone,
    );
  } finally {
    release();
    await context.close();
  }
}

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
    await context.addInitScript(countDraws);
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
            mounting: body.mounting ?? 'floor',
            elevation: body.elevation ?? 0,
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
    /**
     * Waits until the view has settled (a build from #110 on marks the canvas): the first frames
     * and, from #112 on, the finish textures take seconds under software rendering, and a check
     * that the view rests, or a drag, must not start in the middle of them.
     */
    const atRest = async () => {
      const canvas = page.locator('canvas').first();
      if ((await canvas.getAttribute('data-frame').catch(() => null)) === null) return;
      await page
        .waitForSelector('canvas[data-frame="settled"]', { timeout: 240_000 })
        .catch(() => {});
    };
    await atRest();

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
    await atRest();
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
    // The quality setting (#110): three named values, remembered on the device.
    const quality = page.getByRole('group', { name: 'Quality' });
    if ((await quality.count()) === 0) {
      console.log('skip  the Quality control: a build before #110');
    } else {
      const names = await quality
        .getByRole('radio')
        .evaluateAll((radios) => radios.map((r) => r.closest('label')?.textContent?.trim()));
      check(
        'the View panel offers the quality setting in a phone\u2019s words',
        names.join(', ') === 'Fast, Automatic, Always beautiful',
        names.join(', '),
      );
      check('a phone starts on "Automatic"', await quality.getByLabel('Automatic').isChecked());
      await quality.getByLabel('Fast', { exact: true }).tap();
      check(
        'a chosen quality is remembered on the device',
        (await page.evaluate(() => window.localStorage.getItem('my-home.quality'))) === 'fast',
      );
      await quality.getByLabel('Automatic').tap();
    }
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

    // View mode is the default: nothing can be changed until "Edit" is pressed (and "Done" leaves it).
    const editButton = page.getByRole('button', { name: 'Edit', exact: true });
    const doneButton = page.getByRole('button', { name: 'Done', exact: true });
    const editBadge = page.getByRole('status', { name: 'Edit mode' });
    check(
      'a fresh visit is in view mode: the top bar offers "Edit"',
      (await editButton.count()) === 1 && (await doneButton.count()) === 0,
    );
    check('no edit-mode indicator shows in view mode', (await editBadge.count()) === 0);
    const editBox = await editButton.boundingBox();
    check(
      `the Edit button is at least ${TOUCH} px high`,
      editBox.height >= TOUCH,
      `${Math.round(editBox.height)} px`,
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
    check(
      'in view mode the panel offers nothing to place, undo or delete',
      (await furniture.locator('.catalog-item').count()) === 0 &&
        (await furniture.getByRole('button', { name: /^(Undo|Redo|Delete)$/ }).count()) === 0,
    );
    await editButton.tap();
    await settle();
    check(
      '"Edit" turns edit mode on: it becomes "Done" and an indicator shows',
      (await doneButton.count()) === 1 && (await editBadge.isVisible()),
    );
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
    // The edit toolbar; in view mode the selected item shows the piece bar instead (same class).
    const toolbar = page.getByRole('toolbar', { name: /: edit$/ });
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
    // A drag leaves the spot at once: the app takes a finger that stays within 10 px of where it
    // went down for 450 ms as a long press, and the slow software renderer can make small first
    // moves arrive after that. So the first move already travels well beyond the 10 px, and goes
    // out together with the press, without waiting for the renderer in between.
    void touch('touchStart', from.x, from.y);
    // A shorter drag towards the camera, which ends clear of the walls: the long press below must
    // land on the item, and a drag that ends against a wall leaves the item hidden behind it.
    const dragPath = [14, 16, 18, 20, 22, 24];
    /** Where the finger let go: the item followed it there. */
    const dropped = { x: from.x, y: from.y + dragPath.at(-1) };
    void touch('touchMove', from.x, from.y + dragPath[0]);
    for (const dy of dragPath.slice(1)) {
      await touch('touchMove', from.x, from.y + dy);
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
    // The press is taken once the frames before it are drawn: after a drag those are several, a
    // refined one among them, and with textures a software renderer needs seconds for each.
    await atRest();
    await touch('touchStart', dropped.x, dropped.y);
    const deadline = Date.now() + 20_000;
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

    // A wall cabinet by touch: placed on a wall at its height, raised and lowered with ▲ ▼.
    const wallCreated = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/api\/homes\/[^/]+\/placements$/.test(new URL(response.url()).pathname),
      { timeout: 20_000 },
    );
    if ((await snap()) === 'collapsed') await tab(/Furniture/).tap();
    await furniture.getByRole('button', { name: /Wall cabinet/ }).tap();
    const wallResponse = await wallCreated;
    const posted = wallResponse.request().postDataJSON();
    check(
      'a wall cabinet is placed on a wall at its height',
      posted.mounting === 'wall' && posted.elevation === 1.33,
      `${posted.mounting} ${posted.elevation}`,
    );
    const cabinetId = (await wallResponse.json()).id;
    await saved().waitFor({ timeout: 20_000 });
    const height = furniture.getByLabel('Height above the floor in cm');
    check('the panel shows its height in cm', (await height.inputValue()) === '133');
    await page.getByRole('button', { name: 'Close the panel' }).tap();
    await settle();
    await toolbar.waitFor({ timeout: 10_000 });
    const elevation = () => fake.get(cabinetId)?.elevation;
    const heightIs = async (value) => {
      const end = Date.now() + 20_000;
      while (Date.now() < end && Math.abs((elevation() ?? 0) - value) > 1e-6) {
        await page.waitForTimeout(500);
      }
      return Math.abs((elevation() ?? 0) - value) < 1e-6;
    };
    await toolbar.getByRole('button', { name: 'Raise 5 cm' }).tap();
    check('▲ raises it by 5 cm', await heightIs(1.38), `${elevation()}`);
    await toolbar.getByRole('button', { name: 'Lower 5 cm' }).tap();
    check('▼ lowers it by 5 cm', await heightIs(1.33), `${elevation()}`);
    await toolbar.getByRole('button', { name: 'Delete' }).tap();
    check('and the toolbar deletes it', (await until((list) => list.length === 1)).length === 1);
    // "Done": back in view mode the item can be looked at but a drag moves nothing. The finger goes
    // down on the item (where the drag above dropped it) and back up to where it began, so the view
    // ends as it was.
    await doneButton.tap();
    await settle();
    check(
      'leaving edit mode takes the tools and the indicator away',
      (await toolbar.count()) === 0 &&
        (await editBadge.count()) === 0 &&
        (await editButton.count()) === 1,
    );
    const beforeView = (await items())[0];
    const writesBefore = answered;
    void touch('touchStart', dropped.x, dropped.y);
    for (const step of [1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 1, 0]) {
      await touch('touchMove', dropped.x, dropped.y + step * 3);
      await page.waitForTimeout(80);
    }
    await touch('touchEnd');
    await page.waitForTimeout(2500);
    const afterView = (await items())[0];
    check(
      'a drag in view mode moves nothing',
      distance(afterView, beforeView) < 0.01 &&
        afterView.rotationY === beforeView.rotationY &&
        answered === writesBefore,
    );
    // Back as before: the furniture panel open, which walk mode hides and gives back.
    await tab(/Furniture/).tap();
    await settle();

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
    // The width eases over 0.2 s, and the slow software renderer can hold that up for longer than
    // any fixed wait: wait for the rail itself. A sheet that never narrows fails the check below.
    await page
      .waitForFunction(
        (limit) => document.querySelector('.sheet')?.getBoundingClientRect().width <= limit,
        RAIL_MAX,
        { timeout: 20_000 },
      )
      .catch(() => undefined);
    const rail = await box('.sheet');
    check(
      'collapsed, the side sheet is a narrow rail',
      rail.width <= RAIL_MAX,
      `${Math.round(rail.width)} px`,
    );
    await page.screenshot({
      path: out.replace(/\.png$/, '-landscape.png'),
      timeout: SHOT_TIMEOUT_MS,
    });
    await page.setViewportSize(PORTRAIT);
    await page.waitForTimeout(1500);

    await tab(/Furniture/).tap();
    await settle();
    await page.screenshot({ path: out, timeout: SHOT_TIMEOUT_MS });
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
    await context.close();

    // The frame loop: budgets and rest, on a phone and on a desktop.
    for (const device of ['phone', 'desktop']) {
      await frameChecks(browser, { device, base, host, homeId });
      await textureChecks(browser, { device, base, host, homeId });
    }
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
