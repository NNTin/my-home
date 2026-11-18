// Run by catalog-smoke.sh; not meant to be called directly.
//   node catalog-smoke.mjs <out.png> [home-id]   (SITE_BASE, SITE_TOKEN from with-site-token.sh)
// Smoke test of the catalogue pages on a desktop screen (1440x900) and a phone (390x844, touch):
// the entry from the viewer, both kinds, search, thumbnails, use counts, deep links, reload and the
// back button; every type's piece page (3D, dimensions in cm, the section of openings) and the
// playground; `/?focus=<an opening>` in the viewer; the piece page's uses (where-used, a mock-home
// edit and its undo, Place). Every other write is refused (or, for Place, answered) inside the
// browser. Playwright is loaded from MY_HOME_PLAYWRIGHT_DIR.
/* global document, window, caches */
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

/** Smallest comfortable touch target, in CSS pixels. */
const TOUCH = 44;
const PIECE = '/catalog/furniture/furniture.bed';
const SCREENS = [
  { label: 'desktop', viewport: { width: 1440, height: 900 } },
  {
    label: 'phone',
    viewport: { width: 390, height: 844 },
    across: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  },
];

async function smoke(out, homeId) {
  const base = process.env.SITE_BASE;
  const host = new URL(base).host;
  const query = homeId ? `?home=${encodeURIComponent(homeId)}` : '';
  const at = (p) => new URL(`${p}${query}`, base).href;
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const blocked = [];
  /** The mock-home edit and its undo (real writes, undone by the smoke itself). */
  const written = [];
  /** Writes answered inside the browser. */
  const faked = [];
  try {
    for (const { label, viewport, across, ...device } of SCREENS) {
      /**
       * A fresh browser context: no cookies, no cache, no history. Every write is refused, unless
       * `allow(method, path)` lets it through (the self-cleaning mock-home edit and undo) or
       * `fake(method, path, body)` answers it inside the browser (Place).
       */
      const open = async ({ allow, fake } = {}) => {
        const context = await browser.newContext({ viewport, ...device });
        await context.route('**/*', (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.host !== host) return route.continue();
          const method = request.method();
          if (method !== 'GET' && method !== 'HEAD') {
            const answer = fake?.(method, url.pathname, request.postData());
            if (answer) {
              faked.push(`${method} ${url.pathname}`);
              return route.fulfill(answer);
            }
            if (allow?.(method, url.pathname)) {
              written.push(`${method} ${url.pathname}`);
              return route.continue({
                headers: { ...request.headers(), authorization: `Bearer ${token}` },
              });
            }
            blocked.push(`${method} ${url.pathname}`);
            return route.abort();
          }
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
        return { context, page, errors };
      };
      const press = (locator) => (device.hasTouch ? locator.tap() : locator.click());
      const path = (page) => new URL(page.url()).pathname;
      const onHost = (page) => {
        if (new URL(page.url()).host !== host)
          throw new Error('ended on another host (login redirect?)');
      };

      // 0. `/?focus=<id>` frames an opening of the home and shows its chip.
      {
        const { context: focusContext, page: focused, errors: focusErrors } = await open();
        await focused.goto(at('/'), { waitUntil: 'domcontentloaded', timeout: 60_000 });
        onHost(focused);
        const shown = await focused.evaluate(async (id) => {
          const homes = (await (await fetch('/api/homes')).json()).items;
          const home = id ?? homes[0]?.id;
          const model = await (await fetch(`/api/homes/${encodeURIComponent(home)}`)).json();
          const opening = model.openings.find((o) => o.type === 'window') ?? model.openings[0];
          return { home, id: opening.id, name: opening.name, typeId: opening.typeId };
        }, homeId ?? null);
        const focusUrl = new URL('/', base);
        focusUrl.searchParams.set('home', shown.home);
        focusUrl.searchParams.set('focus', shown.id);
        focusUrl.searchParams.set('hints', 'off');
        await focused.goto(focusUrl.href, { waitUntil: 'networkidle', timeout: 60_000 });
        await focused.waitForSelector('canvas', { timeout: 30_000 });
        const chip = device.hasTouch
          ? focused.locator('.piece-toolbar')
          : focused.getByRole('region', { name: 'Furniture' }).getByLabel('Selected piece');
        await chip.waitFor({ timeout: 30_000 }).catch(() => {});
        check(
          `${label}: ?focus= selects ${shown.id} and its chip shows its name`,
          (await chip.count()) === 1 && (await chip.textContent()).includes(shown.name),
        );
        const link = chip.getByRole('link', { name: /Open piece page/ });
        check(
          `${label}: the chip links its piece page`,
          (await link.count()) === 1 &&
            (await link.getAttribute('href')).startsWith(`/catalog/openings/${shown.typeId}?`),
        );
        check(
          `${label}: the focused opening is in view`,
          await focused.evaluate(() => document.querySelector('canvas')?.width > 0),
        );
        await focused.waitForTimeout(1500); // the camera has moved and the frame is drawn
        // Best effort: the viewer draws continuously, which software rendering can make slow.
        const shot = out.replace(/\.png$/, `-focus${device.hasTouch ? '-phone' : ''}.png`);
        await focused
          .screenshot({ path: shot, timeout: 60_000 })
          .then(() => console.log(`screenshot ${shot}`))
          .catch((error) => console.log(`no focus screenshot: ${redact(error.message)}`));
        focusUrl.searchParams.set('focus', 'catalog-smoke-nope');
        await focused.goto(focusUrl.href, { waitUntil: 'networkidle', timeout: 60_000 });
        const alert = focused.getByRole('alert').filter({ hasText: 'Not found in this home' });
        check(
          `${label}: an unknown ?focus= says "Not found in this home"`,
          await alert.waitFor({ timeout: 30_000 }).then(
            () => true,
            () => false,
          ),
        );
        check(
          `${label}: no console or page errors with ?focus=`,
          focusErrors.length === 0,
          focusErrors.slice(0, 3).map(redact).join(' | '),
        );
        await focusContext.close();
      }

      // 1. From the viewer to the catalogue.
      const { context, page, errors } = await open();
      // The first-run hints of the phone would lie over the top bar.
      const viewerUrl = new URL(at('/'));
      viewerUrl.searchParams.set('hints', 'off');
      await page.goto(viewerUrl.href, { waitUntil: 'networkidle', timeout: 60_000 });
      onHost(page);
      await page.waitForSelector('canvas', { timeout: 30_000 });
      const entry = page.getByRole('link', { name: /Catalogue$/ }).first();
      await entry.waitFor({ timeout: 30_000 });
      if (device.hasTouch) {
        const box = await entry.boundingBox();
        check(
          `${label}: the top bar's Catalogue is at least ${TOUCH} px`,
          box && box.width >= TOUCH && box.height >= TOUCH,
          box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'not shown',
        );
      }
      await press(entry);
      const heading = page.getByRole('heading', { level: 1, name: 'Catalogue' });
      await heading.waitFor({ timeout: 30_000 });
      check(`${label}: the entry opens /catalog`, path(page) === '/catalog', page.url());
      check(`${label}: the viewer is gone`, (await page.locator('canvas').count()) === 0);

      // 2. Both kinds, cards, counts, thumbnails.
      for (const kind of ['Windows & doors', 'Furniture']) {
        check(
          `${label}: "${kind}" is shown`,
          await page.getByRole('heading', { level: 2, name: kind }).isVisible(),
        );
      }
      const cards = page.locator('a[data-type-id]');
      const total = await cards.count();
      check(`${label}: cards are listed`, total >= 10, `${total}`);
      await page
        .waitForFunction(() => !document.body.textContent.includes('…'), null, { timeout: 20_000 })
        .catch(() => {});
      const counted = await page.locator('.catalog-uses').allTextContents();
      check(
        `${label}: every card has its number of uses`,
        counted.length === total && counted.every((t) => /^\d+ uses?$/.test(t)),
        counted.slice(0, 4).join(', '),
      );
      const bedName = await page
        .locator(`a[data-type-id="furniture.bed"]`)
        .getAttribute('aria-label');
      check(
        `${label}: a card is named with its uses`,
        /^Bed, \d+ uses?$/.test(bedName ?? ''),
        bedName,
      );
      const firstThumb = page.locator('.catalog-thumb img').first();
      const drawn = await firstThumb
        .waitFor({ timeout: 30_000 })
        .then(() => true)
        .catch(() => false);
      check(`${label}: thumbnails are rendered`, drawn);
      if (drawn) {
        await page.waitForTimeout(1500);
        const cached = await page.evaluate(async () => {
          const cache = await caches.open('my-home-thumbnails');
          return (await cache.keys()).map((r) => decodeURIComponent(new URL(r.url).pathname));
        });
        check(
          `${label}: thumbnails are kept in the Cache Storage`,
          cached.length > 0 &&
            cached.every((k) => /^\/__thumbnails\/thumb:[a-z.-]+:[0-9a-f]{8}$/.test(k)),
          `${cached.length} entries, e.g. ${cached[0] ?? '-'}`,
        );
      }

      // 3. Search filters.
      const search = page.getByRole('searchbox', { name: 'Search the catalogue' });
      await search.fill('casement');
      await page.waitForTimeout(300);
      const found = await cards.evaluateAll((links) => links.map((a) => a.dataset.typeId));
      check(
        `${label}: search filters`,
        found.length === 1 && found[0] === 'window.casement',
        found.join(', '),
      );
      check(
        `${label}: search hides the furniture section`,
        (await page.getByRole('heading', { level: 2, name: 'Furniture' }).count()) === 0,
      );
      await search.fill('');
      await page.waitForTimeout(300);
      check(`${label}: clearing the search shows everything`, (await cards.count()) === total);

      // Every control and link says what it is; nothing scrolls sideways on the phone.
      const unnamed = await page
        .locator('a, button, select, input:not([type=hidden]), textarea')
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
      check(
        `${label}: every control has a name`,
        unnamed.length === 0,
        unnamed.slice(0, 3).join(' | '),
      );
      if (device.hasTouch) {
        const wide = await page.evaluate(() => document.scrollingElement.scrollWidth);
        check(`${label}: nothing scrolls sideways (upright)`, wide <= viewport.width, `${wide} px`);
        const small = await page
          .locator('a[data-type-id], .page-back, .catalog-search')
          .evaluateAll(
            (elements, min) =>
              elements
                .map((e) => ({
                  name: e.getAttribute('aria-label') ?? e.textContent,
                  box: e.getBoundingClientRect(),
                }))
                .filter((e) => e.box.height < min)
                .map((e) => `${e.name.trim()} ${Math.round(e.box.height)} px`),
            TOUCH,
          );
        check(
          `${label}: cards and controls are at least ${TOUCH} px tall`,
          small.length === 0,
          small.join(', '),
        );
        check(
          `${label}: one column`,
          (await page.locator('.catalog-page.mobile').count()) === 1 &&
            new Set(
              await cards.evaluateAll((links) =>
                links.map((a) => Math.round(a.getBoundingClientRect().x)),
              ),
            ).size === 1,
        );
        await page.evaluate(() => window.scrollTo(0, 600));
        await page.waitForTimeout(400);
        const header = await page.locator('.page-header').boundingBox();
        check(
          'phone: the header with the search stays at the top',
          header !== null && Math.abs(header.y) < 1,
        );
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: out.replace(/\.png$/, '-phone.png') });
        await page.setViewportSize(across);
        await page.waitForTimeout(800);
        const acrossWide = await page.evaluate(() => document.scrollingElement.scrollWidth);
        check(
          `${label}: nothing scrolls sideways (across)`,
          acrossWide <= across.width,
          `${acrossWide} px`,
        );
        await page.setViewportSize(viewport);
        await page.waitForTimeout(500);
      } else {
        await page.screenshot({ path: out });
      }

      // 4. A card opens its page; the back button returns to the catalogue, then to the viewer.
      await press(page.locator('a[data-type-id="furniture.bed"]'));
      await page.getByRole('heading', { level: 1, name: /Bed/ }).waitFor({ timeout: 15_000 });
      check(`${label}: a card opens its piece page`, path(page) === PIECE, page.url());
      await page.goBack();
      await heading.waitFor({ timeout: 15_000 });
      check(`${label}: back returns to /catalog`, path(page) === '/catalog', page.url());
      await page.goBack();
      const viewerBack = await page
        .waitForSelector('canvas', { timeout: 30_000 })
        .then(() => true)
        .catch(() => false);
      check(
        `${label}: back again returns to the viewer`,
        viewerBack && path(page) === '/',
        page.url(),
      );
      check(
        `${label}: no console or page errors`,
        errors.length === 0,
        errors.slice(0, 5).map(redact).join(' | '),
      );
      await context.close();

      // 5. A deep link in a fresh context, and a reload.
      const deep = await open();
      const response = await deep.page.goto(at(PIECE), {
        waitUntil: 'networkidle',
        timeout: 60_000,
      });
      onHost(deep.page);
      check(
        `${label}: the deep link is served`,
        response?.status() === 200,
        `${response?.status()}`,
      );
      const pieceHeading = deep.page.getByRole('heading', { level: 1, name: /Bed/ });
      const loaded = await pieceHeading.waitFor({ timeout: 30_000 }).then(
        () => true,
        () => false,
      );
      check(
        `${label}: a deep link to a piece page loads directly`,
        loaded && path(deep.page) === PIECE,
      );
      check(`${label}: its title is the piece`, (await deep.page.title()) === 'Bed · my-home');
      await deep.page.reload({ waitUntil: 'networkidle', timeout: 60_000 });
      const reloaded = await pieceHeading.waitFor({ timeout: 30_000 }).then(
        () => true,
        () => false,
      );
      check(`${label}: a reload keeps the piece page`, reloaded && path(deep.page) === PIECE);
      await press(deep.page.getByRole('link', { name: '← Catalogue' }));
      await deep.page
        .getByRole('heading', { level: 1, name: 'Catalogue' })
        .waitFor({ timeout: 15_000 });
      check(
        `${label}: "← Catalogue" keeps the home`,
        new URL(deep.page.url()).search === query,
        deep.page.url(),
      );
      await deep.page.reload({ waitUntil: 'networkidle', timeout: 60_000 });
      const again = await deep.page
        .getByRole('heading', { level: 1, name: 'Catalogue' })
        .waitFor({ timeout: 30_000 })
        .then(
          () => true,
          () => false,
        );
      check(`${label}: a reload keeps /catalog`, again);
      check(
        `${label}: no console or page errors on the deep link`,
        deep.errors.length === 0,
        deep.errors.slice(0, 5).map(redact).join(' | '),
      );
      await deep.context.close();

      // 6. Every type's piece page: the 3D inspector, dimensions in cm, the section of openings,
      // and the playground (which never writes: see "nothing was written").
      const pages = await open();
      const p = pages.page;
      await p.goto(at('/catalog'), { waitUntil: 'networkidle', timeout: 60_000 });
      onHost(p);
      await p.locator('a[data-type-id]').first().waitFor({ timeout: 30_000 });
      const types = await p
        .locator('a[data-type-id]')
        .evaluateAll((links) =>
          links.map((a) => ({ id: a.dataset.typeId, href: new URL(a.href).pathname })),
        );
      const cm = /^\d+\.\d cm$/;
      const shot = (name) =>
        out.replace(/\.png$/, `-${name}${device.hasTouch ? '-phone' : ''}.png`);
      for (const { id, href } of types) {
        await p.goto(at(href), { waitUntil: 'networkidle', timeout: 60_000 });
        await p.locator('h1').waitFor({ timeout: 30_000 });
        const canvas = await p
          .locator('.piece-viewport canvas')
          .waitFor({ timeout: 30_000 })
          .then(() => true)
          .catch(() => false);
        const labels = await p
          .locator('.dimension-label')
          .first()
          .waitFor({ timeout: 15_000 })
          .then(() => p.locator('.dimension-label').allTextContents())
          .catch(() => []);
        const listed = await p.locator('.piece-dimensions dd').allTextContents();
        check(
          `${label}: ${id} draws in 3D with dimensions in cm`,
          canvas &&
            labels.length > 0 &&
            labels.every((t) => cm.test(t.trim())) &&
            listed.length >= labels.length &&
            listed.every((t) => cm.test(t.trim())),
          `${canvas ? 'canvas' : 'no canvas'}; ${labels.join(', ')}`,
        );
        if (id.startsWith('window.') || id.startsWith('door.') || id.startsWith('gate.')) {
          if (!device.hasTouch && id === 'window.casement')
            await p.screenshot({ path: shot('window') });
          await press(p.getByRole('button', { name: 'Section', exact: true }));
          const svg = p.locator('svg.section');
          await svg.waitFor({ timeout: 10_000 }).catch(() => {});
          const roles = await svg
            .locator('rect[data-role]')
            .evaluateAll((rects) => rects.map((r) => r.dataset.role));
          const glazed = /^(window\.(casement|tilt-turn)|door\.french)$/.test(id);
          const wall = id.startsWith('window.') && id !== 'window.roof';
          const ok = glazed
            ? roles.includes('frame') && roles.includes('glass')
            : id.startsWith('door.')
              ? roles.includes('frame')
              : roles.length > 0;
          const sectionLabels = await p.locator('.section-labels dd').allTextContents();
          check(
            `${label}: ${id} has its section`,
            ok &&
              (!wall || roles.includes('wall')) &&
              sectionLabels.every((t) => cm.test(t.trim())),
            `${[...new Set(roles)].join(', ')}; ${sectionLabels.join(', ')}`,
          );
          if (!device.hasTouch && id === 'window.casement')
            await p.screenshot({ path: shot('window-section') });
          if (!device.hasTouch && id === 'door.french') {
            await press(p.getByRole('button', { name: '3D', exact: true }));
            await p
              .locator('.dimension-label')
              .first()
              .waitFor({ timeout: 15_000 })
              .catch(() => {});
            await p.waitForTimeout(500);
            await p.screenshot({ path: shot('door') });
          }
        }
      }

      // The playground: a colour and a size change the preview live, and nothing is sent.
      await p.goto(at('/catalog/furniture/furniture.bed'), {
        waitUntil: 'networkidle',
        timeout: 60_000,
      });
      await p.locator('.piece-viewport canvas').waitFor({ timeout: 30_000 });
      const hex = p.getByRole('textbox', { name: 'Colour, hex' });
      await hex.fill('#336699');
      await hex.blur();
      const width = p.getByRole('textbox', { name: 'Width', exact: true });
      await width.fill('180');
      await width.blur();
      await p.waitForTimeout(800);
      const shown = await p.locator('.piece-dimensions dd').first().textContent();
      const labelled = await p.locator('.dimension-label').allTextContents();
      check(
        `${label}: the playground changes the bed live`,
        shown === '180.0 cm' &&
          labelled.includes('180.0 cm') &&
          (await hex.inputValue()) === '#336699',
        `${shown}; ${labelled.join(', ')}`,
      );
      check(
        `${label}: the playground state is in the address`,
        new URL(p.url()).searchParams.has('p'),
        p.url(),
      );
      await width.fill('500');
      check(
        `${label}: a size beyond the limit is not applied`,
        (await p.getByRole('alert').textContent()) === 'At most 220.0 cm' &&
          (await p.locator('.piece-dimensions dd').first().textContent()) === '180.0 cm',
      );
      await width.blur();
      if (device.hasTouch) {
        const wide = await p.evaluate(() => document.scrollingElement.scrollWidth);
        check(
          `${label}: the piece page does not scroll sideways`,
          wide <= viewport.width,
          `${wide} px`,
        );
        const small = await p
          .locator(
            '.piece-page button, .playground-field, .playground-color, .playground-slider, .piece-toggle, .page-back',
          )
          .evaluateAll(
            (elements, min) =>
              elements
                .filter((e) => e.getClientRects().length > 0)
                .map((e) => ({
                  name: e.getAttribute('aria-label') ?? e.textContent,
                  box: e.getBoundingClientRect(),
                }))
                .filter((e) => e.box.height < min)
                .map((e) => `${e.name.trim()} ${Math.round(e.box.height)} px`),
            TOUCH,
          );
        check(
          `${label}: piece page controls are at least ${TOUCH} px`,
          small.length === 0,
          small.join(', '),
        );
        const stage = await p.locator('.piece-viewport').boundingBox();
        check(
          `${label}: the inspector takes about 40 % of the height upright`,
          stage !== null && Math.abs(stage.height / viewport.height - 0.4) < 0.05,
          stage ? `${Math.round(stage.height)} px` : 'not shown',
        );
        await p.evaluate(() => window.scrollTo(0, 0));
        await p.waitForTimeout(300);
        await p.screenshot({ path: shot('bed') });
        await p.setViewportSize(across);
        await p.waitForTimeout(800);
        const acrossStage = await p.locator('.piece-viewport').boundingBox();
        const acrossWide = await p.evaluate(() => document.scrollingElement.scrollWidth);
        check(
          `${label}: the inspector is usable across (${across.width}x${across.height})`,
          acrossStage !== null &&
            acrossStage.height >= 150 &&
            acrossStage.width >= 300 &&
            acrossWide <= across.width,
          acrossStage
            ? `${Math.round(acrossStage.width)}x${Math.round(acrossStage.height)}, ${acrossWide} px wide`
            : 'not shown',
        );
        await p.screenshot({ path: shot('bed-across') });
        await p.setViewportSize(viewport);
      } else {
        await p.screenshot({ path: shot('bed') });
      }
      check(
        `${label}: no console or page errors on the piece pages`,
        pages.errors.length === 0,
        pages.errors.slice(0, 5).map(redact).join(' | '),
      );
      await pages.context.close();

      await usesStep({ label, device, open, press, base, homeId, shot });
    }
    check('nothing else was written', blocked.length === 0, blocked.join(', '));
    check(
      'the only real writes were the mock-home edit and its undo',
      written.every((w) => w.includes('/api/homes/mock-home/')) && written.length <= 2,
      written.join(', ') || 'none',
    );
    console.log(`answered in the browser: ${faked.join(', ') || 'nothing'}`);
    console.log(
      `screenshots ${out} ${out.replace(/\.png$/, '-phone.png')} and ${out.replace(/\.png$/, '-*.png')}`,
    );
  } finally {
    await browser.close();
  }
}

const MOCK = 'mock-home';
/** Production's host: the smoke never writes there, whatever its homes. */
const PRODUCTION_HOST = 'home.nntin.xyz';
const WINDOW = 'window.casement';

/** Waits for `fn` (in the page) to be true; false after `timeout` ms. */
const until = (page, fn, arg, timeout = 30_000) =>
  page.waitForFunction(fn, arg, { timeout }).then(
    () => true,
    () => false,
  );

/** A use of the mock home as the api has it now. */
const mockUse = (page, id) =>
  page.evaluate(
    async ({ home, type, id }) => {
      const res = await fetch(`/api/homes/${home}/uses?typeId=${type}`);
      return (await res.json()).items.find((u) => u.id === id);
    },
    { home: MOCK, type: WINDOW, id },
  );

/**
 * 7. The piece page's uses (#45). Where-used of `door.interior` in the first home (read-only), with
 * the catalogue's count. Where `mock-home` exists (staging) and never on production: on the desktop, a real edit of a mock-home window's frame colour through
 * the editor, its history row (actor agent), and Undo, which puts the colour back: the smoke cleans
 * up after itself (the history rows stay, on the mock home). On the phone, that history read-only.
 * Place on the bed's page (of the mock home, else the first home), with the POST answered inside the
 * browser: no placement is created. Without a mock home the edit is skipped and logged, nothing else.
 */
async function usesStep({ label, device, open, press, base, homeId, shot }) {
  const url = (p) => new URL(p, base).href;
  let facts;

  // Where-used, read-only.
  {
    const { context, page, errors } = await open();
    await page.goto(url('/'), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    facts = await page.evaluate(
      async ({ id, mock }) => {
        const homes = (await (await fetch('/api/homes')).json()).items;
        const usage = (await (await fetch('/api/catalog/usage')).json()).counts;
        return {
          home: id ?? homes[0]?.id,
          count: usage['door.interior'],
          hasMock: homes.some((h) => h.id === mock),
        };
      },
      { id: homeId ?? null, mock: MOCK },
    );
    await page.goto(url(`/catalog/openings/door.interior?home=${encodeURIComponent(facts.home)}`), {
      waitUntil: 'networkidle',
      timeout: 60_000,
    });
    await page.locator('.piece-page h1').waitFor({ timeout: 30_000 });
    // A build from before #45 (production before its merge, an older branch on staging) has no
    // uses on the piece page: say so and leave the rest of this step out.
    if ((await page.getByRole('region', { name: 'Uses' }).count()) === 0) {
      console.log(
        `skip  ${label}: this build's piece page has no uses (before #45): step 7 left out`,
      );
      await context.close();
      return;
    }
    const count = page.locator('.uses-count');
    await count.waitFor({ timeout: 30_000 }).catch(() => {});
    check(
      `${label}: where-used counts the uses as the catalogue does`,
      (await count.count()) === 1 &&
        (await count.textContent()) ===
          `${facts.count} use${facts.count === 1 ? '' : 's'} in this environment`,
      (await count.count()) ? await count.textContent() : 'not shown',
    );
    const rows = page.locator('.use-row');
    const links = await page
      .getByRole('link', { name: /in model$/ })
      .evaluateAll((as) => as.map((a) => new URL(a.href).search));
    check(
      `${label}: every use links to the model (?focus=)`,
      links.length > 0 &&
        links.length <= (await rows.count()) &&
        links.every((q) => q.includes('focus=')),
      `${await rows.count()} rows, ${links.length} links`,
    );
    const section = page.getByRole('region', { name: 'Uses' });
    await section.scrollIntoViewIfNeeded().catch(() => {});
    await section
      .screenshot({ path: shot('uses'), timeout: 60_000 })
      .catch((error) => console.log(`no uses screenshot: ${redact(error.message)}`));
    check(
      `${label}: no console or page errors on where-used`,
      errors.length === 0,
      errors.slice(0, 3).map(redact).join(' | '),
    );
    await context.close();
  }

  // The mock home's window: edit (desktop only), history, undo. Only where there is a mock home
  // (staging; production syncs home.json only) and never on production's host.
  const editable = facts.hasMock && new URL(base).host !== PRODUCTION_HOST;
  if (!editable) {
    console.log(
      `skip  ${label}: skipped: no ${MOCK} (or production): no edit and undo; where-used and Place run`,
    );
  } else {
    let target;
    const allow = (method, path) =>
      target !== undefined &&
      ((method === 'PUT' && path === `/api/homes/${MOCK}/opening-overrides/${target}`) ||
        (method === 'POST' &&
          new RegExp(`^/api/homes/${MOCK}/uses/${target}/history/[0-9a-f-]+/undo$`).test(path)));
    const { context, page, errors } = await open({ allow: device.hasTouch ? undefined : allow });
    await page.goto(url('/'), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const picked = await page.evaluate(
      async ({ home, type }) => {
        const res = await fetch(`/api/homes/${home}/uses?typeId=${type}`);
        if (!res.ok) return undefined;
        const items = (await res.json()).items.filter(
          (u) => u.source === 'git' && u.status === 'ok',
        );
        return items.find((u) => u.id === 'souterrain-kitchen-window') ?? items[0];
      },
      { home: MOCK, type: WINDOW },
    );
    check(`${label}: the mock home has a ${WINDOW} to edit`, picked !== undefined);
    if (picked) {
      const before = picked.overrides;
      const colour = picked.effective.frameColor === '#2a5d8f' ? '#8f2a5d' : '#2a5d8f';
      await page.goto(url(`/catalog/openings/${WINDOW}?home=${MOCK}#use=${picked.id}`), {
        waitUntil: 'networkidle',
        timeout: 60_000,
      });
      const row = page.locator(`[id="use-${MOCK}-${picked.id}"]`);
      const editor = page.getByRole('region', { name: `Edit ${picked.name}` });
      check(
        `${label}: #use= opens the use's editor`,
        await editor.waitFor({ timeout: 30_000 }).then(
          () => true,
          () => false,
        ),
      );
      const history = row.getByRole('region', { name: 'History' });
      if (!device.hasTouch) {
        target = picked.id;
        try {
          const hex = editor.getByRole('textbox', { name: 'Frame colour, hex' });
          await hex.fill(colour);
          await hex.blur();
          await press(editor.getByRole('button', { name: 'Save', exact: true }));
          check(
            `${label}: the edit is saved and shown in the row`,
            await row
              .getByLabel('Overrides')
              .filter({ hasText: colour })
              .waitFor({ timeout: 30_000 })
              .then(
                () => true,
                () => false,
              ),
          );
          await press(row.getByRole('button', { name: `History of ${picked.name}` }));
          const top = history.locator('li').first();
          await top.waitFor({ timeout: 30_000 }).catch(() => {});
          const text = (await top.count()) ? await top.textContent() : '';
          check(
            // With the agent token the api records an agent; without one (local runs) the owner.
            `${label}: the history shows the change, by ${token ? 'the agent' : 'you'}`,
            text.includes(`→ ${colour}`) && text.includes(token ? 'Agent' : 'You'),
            text,
          );
          await press(top.getByRole('button', { name: /^Undo/ }));
          // This run's rows: earlier runs left struck-through rows of their own further down.
          const items = history.locator('li');
          const undid = items
            .nth(0)
            .filter({ hasText: `${colour} →` })
            .filter({ hasText: '(undo)' });
          const struck = items
            .nth(1)
            .locator('s')
            .filter({ hasText: `→ ${colour}` });
          check(
            `${label}: Undo is one click and strikes the change through`,
            await Promise.all([
              undid.waitFor({ timeout: 30_000 }),
              struck.waitFor({ timeout: 30_000 }),
            ]).then(
              () => true,
              () => false,
            ),
          );
          const same = (u) =>
            u?.effective.frameColor === picked.effective.frameColor &&
            JSON.stringify(Object.entries(u.overrides).sort()) ===
              JSON.stringify(Object.entries(before).sort());
          let after = await mockUse(page, picked.id);
          for (let i = 0; i < 20 && !same(after); i++) {
            await page.waitForTimeout(500);
            after = await mockUse(page, picked.id);
          }
          check(
            `${label}: the colour is back after the undo`,
            same(after),
            `${after?.effective.frameColor}, overrides ${JSON.stringify(after?.overrides)}`,
          );
        } finally {
          // Cleans up by hand should a step have failed between the save and the undo.
          const now = await mockUse(page, picked.id).catch(() => undefined);
          if (
            now &&
            JSON.stringify(Object.entries(now.overrides).sort()) !==
              JSON.stringify(Object.entries(before).sort())
          ) {
            const status = await page.evaluate(
              async ({ home, id, version, params }) =>
                (
                  await fetch(`/api/homes/${home}/opening-overrides/${id}`, {
                    method: 'PUT',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ version, params }),
                  })
                ).status,
              { home: MOCK, id: picked.id, version: now.version, params: before },
            );
            check(`${label}: cleanup put the overrides back`, status === 200, String(status));
          }
          target = undefined;
        }
      } else {
        await press(row.getByRole('button', { name: `History of ${picked.name}` }));
        check(
          `${label}: the history (read-only here) shows undone changes`,
          await history
            .locator('li')
            .first()
            .waitFor({ timeout: 30_000 })
            .then(
              () => true,
              () => false,
            ),
        );
      }
      await row.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await row
        .screenshot({ path: shot('history'), timeout: 60_000 })
        .catch((error) => console.log(`no history screenshot: ${redact(error.message)}`));
    }
    check(
      `${label}: no console or page errors while editing`,
      errors.length === 0,
      errors.slice(0, 3).map(redact).join(' | '),
    );
    await context.close();
  }

  // Place, with the POST answered in the browser (on the mock home where there is one).
  const placeHome = facts.hasMock ? MOCK : facts.home;
  {
    const posts = [];
    const fake = (method, path, body) => {
      if (method !== 'POST' || !/^\/api\/homes\/[^/]+\/placements$/.test(path)) return undefined;
      const sent = JSON.parse(body);
      posts.push(sent);
      const at = new Date().toISOString();
      return {
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'catalog-smoke-place',
          homeId: path.split('/')[3],
          typeId: sent.typeId,
          name: 'Catalog smoke · Bed',
          levelId: sent.levelId,
          roomId: null,
          position: sent.position,
          rotationY: sent.rotationY ?? 0,
          params: sent.params ?? {},
          version: 1,
          createdAt: at,
          updatedAt: at,
          removedAt: null,
          purgeAt: null,
        }),
      };
    };
    const { context, page } = await open({ fake });
    const p = `/catalog/furniture/furniture.bed?home=${encodeURIComponent(placeHome)}&p=${Buffer.from(JSON.stringify({ width: 1.8 })).toString('base64url')}`;
    await page.goto(url(p), { waitUntil: 'networkidle', timeout: 60_000 });
    const placeButton = page.getByRole('button', { name: 'Place…' });
    await placeButton.waitFor({ timeout: 30_000 }).catch(() => {});
    if ((await placeButton.count()) === 1) {
      await press(placeButton);
      const form = page.getByRole('form', { name: 'Place' });
      await form.waitFor({ timeout: 10_000 });
      await form.scrollIntoViewIfNeeded();
      await form.screenshot({ path: shot('place') }).catch(() => {});
      await press(form.getByRole('button', { name: 'Place and open in the viewer' }));
      const opened = await until(page, () => window.location.pathname === '/');
      const search = new URL(page.url()).searchParams;
      check(
        `${label}: Place sends the playground values and opens the viewer on the new piece`,
        opened &&
          posts.length === 1 &&
          posts[0].typeId === 'furniture.bed' &&
          posts[0].params?.width === 1.8 &&
          search.get('focus') === 'catalog-smoke-place' &&
          search.get('panel') === 'furniture' &&
          search.get('home') === placeHome,
        `${JSON.stringify(posts[0] ?? {})} → ${page.url().replace(base, '')}`,
      );
    } else {
      check(`${label}: the bed's page offers Place`, false);
    }
    await context.close();
  }
}

smoke(process.argv[2], process.argv[3]).then(
  () => {
    console.log(failures.length ? `FAILED: ${failures.join('; ')}` : 'catalog smoke test passed');
    process.exit(failures.length ? 1 : 0);
  },
  (error) => {
    console.error(`FAILED: ${redact(error.message)}`);
    process.exit(1);
  },
);
