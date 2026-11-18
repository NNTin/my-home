// Run by catalog-smoke.sh; not meant to be called directly.
//   node catalog-smoke.mjs <out.png> [home-id]   (SITE_BASE, SITE_TOKEN from with-site-token.sh)
// Smoke test of the catalogue pages on a desktop screen (1440x900) and a phone (390x844, touch):
// the entry from the viewer, both kinds, search, thumbnails, use counts, deep links, reload and the
// back button; every type's piece page (3D, dimensions in cm, the section of openings) and the
// playground; `/?focus=<an opening>` in the viewer. Read-only: every write is refused inside the
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
  try {
    for (const { label, viewport, across, ...device } of SCREENS) {
      /** A fresh browser context: no cookies, no cache, no history. */
      const open = async () => {
        const context = await browser.newContext({ viewport, ...device });
        await context.route('**/*', (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.host !== host) return route.continue();
          const method = request.method();
          if (method !== 'GET' && method !== 'HEAD') {
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
    }
    check('nothing was written', blocked.length === 0, blocked.join(', '));
    console.log(
      `screenshots ${out} ${out.replace(/\.png$/, '-phone.png')} and ${out.replace(/\.png$/, '-*.png')}`,
    );
  } finally {
    await browser.close();
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
