// Run by catalog-smoke.sh; not meant to be called directly.
//   node catalog-smoke.mjs <out.png> [home-id]   (SITE_BASE, SITE_TOKEN from with-site-token.sh)
// Smoke test of the catalogue pages on a desktop screen (1440x900) and a phone (390x844, touch):
// the entry from the viewer, both kinds, search, thumbnails, use counts, deep links, reload and the
// back button; every type's piece page (3D, dimensions in cm, the section of openings) and the
// playground; `/?focus=<an opening>` in the viewer; the piece page's uses (where-used, the editor
// and its history, Place). It never writes: every write is refused, or (Save, Place) answered
// inside the browser. SMOKE_SHARD=i/n runs one of CI's shards: <screen>/catalogue (every step but the
// piece pages) and <screen>/piece/<type> are its parts (parts.mjs). Playwright is loaded from MY_HOME_PLAYWRIGHT_DIR.
/* global document, window, caches */
import { createRequire } from 'node:module';
import path from 'node:path';
import { answeredInfrastructure } from './infrastructure.mjs';
import { recordCheck, selectParts, stopwatch } from './parts.mjs';
import { loadingScreenGone, missedTouches, SCENE } from './scene.mjs';

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
  recordCheck(name, ok);
  if (!ok) failures.push(name);
};

/**
 * The kitchen, corridor and fixture types (#62): each must be on /catalog (under its kind), and its
 * piece page must say how it is mounted, and offer Place (on the floor, a wall or the ceiling).
 */
const MOUNTED_TYPES = {
  'kitchen.base-cabinet': { kind: 'furniture', mounting: /^Stands on the floor\.$/ },
  'kitchen.wall-cabinet': { kind: 'furniture', mounting: /^Hangs on a wall, its bottom 133\.0 cm/ },
  'kitchen.wall-shelf': { kind: 'furniture', mounting: /^Hangs on a wall, its bottom 152\.0 cm/ },
  'kitchen.tall-cabinet': { kind: 'furniture', mounting: /^Stands on the floor\.$/ },
  'appliance.fridge-freezer': {
    kind: 'furniture',
    mounting: /^Stands on the floor\.$/,
  },
  'appliance.microwave': { kind: 'furniture', mounting: /^Stands on a worktop, 90\.0 cm/ },
  'furniture.shoe-cabinet': { kind: 'furniture', mounting: /^Stands on the floor\.$/ },
  'furniture.storage-shelf': {
    kind: 'furniture',
    mounting: /^Stands on the floor\.$/,
  },
  'fixture.downlight': { kind: 'fixtures', mounting: /^Fixed to the ceiling\.$/ },
  'fixture.radiator': { kind: 'fixtures', mounting: /^Hangs on a wall, its bottom 10\.0 cm/ },
};

/** Smallest comfortable touch target, in CSS pixels. */
const TOUCH = 44;
// A type's card: a sakuga-card since HUD v2 #200 (its link is in its shadow root), a plain link before.
const CARD = '[data-type-id]:is(a, sakuga-card)';
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

/**
 * The piece page's 3D / Section switch: a sakuga-segmented's radio since #168 PR 7/2, a button on an older
 * build (staging may run one).
 */
const viewSwitch = (p, name) =>
  p
    .getByRole('radio', { name, exact: true })
    .or(p.getByRole('button', { name, exact: true }))
    .first();

async function smoke(out, homeId) {
  const base = process.env.SITE_BASE;
  const host = new URL(base).host;
  const query = homeId ? `?home=${encodeURIComponent(homeId)}` : '';
  const at = (p) => new URL(`${p}${query}`, base).href;
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const blocked = [];
  /** Writes answered inside the browser. */
  const faked = [];
  const lap = stopwatch();
  try {
    // A shard (SMOKE_SHARD=i/n, parts.mjs) needs every part's name first: the types the catalogue lists.
    const sharded = Boolean(process.env.SMOKE_SHARD);
    const listed = sharded ? await listTypes(browser, host, at('/catalog')) : [];
    const parts = sharded
      ? selectParts(
          'catalog',
          SCREENS.flatMap(({ label }) => [
            `${label}/catalogue`,
            ...listed.map((id) => `${label}/piece/${id}`),
          ]),
        )
      : null;
    const runs = (part) => !parts || parts.has(part);
    for (const { label, viewport, across, ...device } of SCREENS) {
      /**
       * A fresh browser context: no cookies, no cache, no history. Every write is refused, unless
       * `fake(method, path, body)` answers it inside the browser (Save, Place): the smoke never
       * writes on a deployed environment.
       */
      const open = async ({ fake } = {}) => {
        const context = await browser.newContext({ viewport, ...device });
        await context.route('**/*', (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.host !== host) return route.continue();
          // Cloudflare's own requests (its analytics beacon) are answered here: no write, no error.
          if (answeredInfrastructure(route, host)) return;
          const method = request.method();
          if (method !== 'GET' && method !== 'HEAD') {
            const answer = fake?.(method, url.pathname, request.postData());
            if (answer) {
              faked.push(`${method} ${url.pathname}`);
              return route.fulfill(answer);
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
      /** Whether `locator` shows within a generous budget: a slow software render is not a crash. */
      const shows = (locator) =>
        locator.waitFor({ timeout: 60_000 }).then(
          () => true,
          () => false,
        );
      const onHost = (page) => {
        if (new URL(page.url()).host !== host)
          throw new Error('ended on another host (login redirect?)');
      };

      if (runs(`${label}/catalogue`)) {
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
          await focused.waitForSelector(SCENE, { timeout: 30_000 });
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
            await focused.evaluate((scene) => document.querySelector(scene)?.width > 0, SCENE),
          );
          await focused.waitForTimeout(1500); // the camera has moved and the frame is drawn
          // Best effort: the viewer draws continuously, which software rendering can make slow.
          const shot = out.replace(/\.png$/, `-focus${device.hasTouch ? '-phone' : ''}.png`);
          await focused
            .screenshot({ path: shot, timeout: 60_000 })
            .then(() => console.log(`screenshot ${shot}`))
            .catch((error) => console.log(`no focus screenshot: ${redact(error.message)}`));
          focusUrl.searchParams.set('focus', 'catalog-smoke-nope');
          // Not `networkidle`: the message shows for a few seconds, and the page keeps fetching
          // (finish textures) for longer than that.
          await focused.goto(focusUrl.href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
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
        lap(`${label}/focus`);

        // 1. From the viewer to the catalogue.
        const { context, page, errors } = await open();
        // The first-run hints of the phone would lie over the top bar.
        const viewerUrl = new URL(at('/'));
        viewerUrl.searchParams.set('hints', 'off');
        await page.goto(viewerUrl.href, { waitUntil: 'networkidle', timeout: 60_000 });
        onHost(page);
        await page.waitForSelector(SCENE, { timeout: 30_000 });
        // The first frames and the finish textures keep a software renderer busy for many seconds;
        // a click waits for the page. A build from #110 on marks the canvas when the view has settled.
        if ((await page.locator(SCENE).first().getAttribute('data-frame')) !== null) {
          await page
            .waitForSelector('canvas[data-frame="settled"]', { timeout: 240_000 })
            .catch(() => {});
        }
        // In Tools since HUD v2 #200 (a menu over the stage tools, or the desktop's surface); at rest before.
        const toolsButton = page.getByRole('button', { name: 'Tools', exact: true });
        if ((await toolsButton.count()) > 0) {
          await (device.hasTouch ? toolsButton.tap() : toolsButton.click());
        }
        const entry = page.getByRole('link', { name: /Catalogue$/ }).first();
        await entry.waitFor({ timeout: 30_000 });
        if (device.hasTouch) {
          // Its hit area, not its box: the compact icon button draws a 34 px face and takes touches
          // TOUCH px around it inside its shadow root (docs/design/hud.md §3.3). The middle of each
          // edge of the TOUCH-px square around its centre, 1 px inside, and the centre must land on it.
          const box = await entry.boundingBox();
          const missed = await entry.evaluate((e, min) => {
            const owner = e.getRootNode().host ?? e;
            const r = e.getBoundingClientRect();
            const [cx, cy] = [r.x + r.width / 2, r.y + r.height / 2];
            const [w, h] = [Math.max(r.width, min) / 2 - 1, Math.max(r.height, min) / 2 - 1];
            return [
              [cx - w, cy],
              [cx + w, cy],
              [cx, cy - h],
              [cx, cy + h],
              [cx, cy],
            ].filter(([x, y]) => {
              // A finger touches the screen only: a probe past its edge comes back to it.
              const hit = document.elementFromPoint(
                Math.min(Math.max(x, 0), document.documentElement.clientWidth - 1),
                Math.min(Math.max(y, 0), document.documentElement.clientHeight - 1),
              );
              return !(hit && (hit === owner || owner.contains(hit)));
            }).length;
          }, TOUCH);
          check(
            `${label}: the top bar's Catalogue takes a touch at least ${TOUCH} px across`,
            box && missed === 0,
            box
              ? `${Math.round(box.width)}x${Math.round(box.height)}, ${missed} of 5 points missed`
              : 'not shown',
          );
        }
        await press(entry);
        const heading = page.getByRole('heading', { level: 1, name: 'Catalogue' });
        await heading.waitFor({ timeout: 30_000 });
        check(`${label}: the entry opens /catalog`, path(page) === '/catalog', page.url());
        check(`${label}: the viewer is gone`, (await page.locator(SCENE).count()) === 0);

        lap(`${label}/entry`);
        // 2. Both kinds, cards, counts, thumbnails.
        for (const kind of ['Windows & doors', 'Furniture']) {
          check(
            `${label}: "${kind}" is shown`,
            await page.getByRole('heading', { level: 2, name: kind }).isVisible(),
          );
        }
        const cards = page.locator(CARD);
        const total = await cards.count();
        // #62: the fixtures are a section of their own (a build before #62 has none: skipped).
        const listed = new Set(
          await cards.evaluateAll((links) => links.map((a) => a.dataset.typeId)),
        );
        const mountedListed = Object.keys(MOUNTED_TYPES).filter((id) => listed.has(id));
        if (mountedListed.length === 0) {
          console.log(`skip  ${label}: this build has no kitchen or fixture types (before #62)`);
        } else {
          check(
            `${label}: every kitchen, corridor and fixture type is listed`,
            mountedListed.length === Object.keys(MOUNTED_TYPES).length,
            Object.keys(MOUNTED_TYPES)
              .filter((id) => !listed.has(id))
              .join(', ') || `${mountedListed.length} types`,
          );
          const fixtures = page.getByRole('region', { name: 'Fixtures' });
          const groups = await fixtures
            .getByRole('heading', { level: 3 })
            .allTextContents()
            .catch(() => []);
          const fixtureCards = await fixtures
            .locator(CARD)
            .evaluateAll((links) => links.map((a) => a.dataset.typeId))
            .catch(() => []);
          check(
            `${label}: "Fixtures" is its own section, by category`,
            (await page.getByRole('heading', { level: 2, name: 'Fixtures' }).isVisible()) &&
              groups.join(',') === 'Heating,Lighting' &&
              fixtureCards.every((id) => id.startsWith('fixture.')) &&
              fixtureCards.length === 2,
            `${groups.join(', ')}; ${fixtureCards.join(', ')}`,
          );
        }
        // The outdoor kind (garden and patio pieces) is a section of its own; a build before it has none.
        const gardenListed = [...listed].filter((id) => id.startsWith('garden.'));
        if (gardenListed.length === 0) {
          console.log(`skip  ${label}: this build has no outdoor types`);
        } else {
          const outdoor = page.getByRole('region', { name: 'Outdoor' });
          const outdoorCards = await outdoor
            .locator(CARD)
            .evaluateAll((links) => links.map((a) => a.dataset.typeId))
            .catch(() => []);
          check(
            `${label}: "Outdoor" is its own section with every garden type`,
            (await page.getByRole('heading', { level: 2, name: 'Outdoor' }).isVisible()) &&
              outdoorCards.length === gardenListed.length &&
              outdoorCards.every((id) => id.startsWith('garden.')),
            `${outdoorCards.length} of ${gardenListed.length}`,
          );
        }
        check(`${label}: cards are listed`, total >= 10, `${total}`);
        await page
          .waitForFunction(() => !document.body.textContent.includes('…'), null, {
            timeout: 20_000,
          })
          .catch(() => {});
        const counted = await page.locator('.catalog-uses').allTextContents();
        check(
          `${label}: every card has its number of uses`,
          counted.length === total && counted.every((t) => /^\d+ uses?$/.test(t)),
          counted.slice(0, 4).join(', '),
        );
        // The finishes of the library, after the kinds (a build before #112 has none).
        const finishCards = page.locator('[data-finish-id]');
        const finishCount = await finishCards.count();
        if (finishCount === 0) console.log(`skip  ${label}: finishes (a build before #112)`);
        else {
          const sources = await finishCards.locator('.finish-source').allTextContents();
          const textured = sources.filter((t) => t.startsWith('Texture:'));
          check(
            `${label}: the finishes are listed, each textured one with a CC0 source`,
            finishCount >= 20 &&
              sources.length === finishCount &&
              textured.length >= 12 &&
              textured.every((t) => t.includes('licence CC0-1.0')) &&
              (await finishCards.locator('.finish-source a').count()) === textured.length,
            `${finishCount} finishes, ${textured.length} textured`,
          );
          const wide = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
          );
          check(`${label}: the finishes do not make the page scroll sideways`, !wide);
          // A card holds its text: nothing in it reaches past its frame.
          const spills = await page.evaluate(
            () =>
              [...document.querySelectorAll('[data-finish-id] .finish')].filter(
                (frame) =>
                  frame.scrollHeight > frame.clientHeight + 1 ||
                  frame.scrollWidth > frame.clientWidth + 1,
              ).length,
          );
          check(`${label}: every finish card holds its text`, spills === 0, `${spills} spill`);
        }
        const bedName = await page
          .locator(`${CARD}[data-type-id="furniture.bed"]`)
          .evaluate((card) => card.getAttribute('aria-label') ?? card.getAttribute('label'));
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

        lap(`${label}/kinds`);
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
          check(
            `${label}: nothing scrolls sideways (upright)`,
            wide <= viewport.width,
            `${wide} px`,
          );
          const small = await page.locator(`${CARD}, .page-back, .catalog-search`).evaluateAll(
            (elements, min) =>
              elements
                .map((e) => ({
                  name: e.getAttribute('aria-label') ?? e.getAttribute('label') ?? e.textContent,
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

        lap(`${label}/search`);
        // 4. A card opens its page; the back button returns to the catalogue, then to the viewer.
        await press(page.locator(`${CARD}[data-type-id="furniture.bed"]`));
        const opened = await shows(page.getByRole('heading', { level: 1, name: /Bed/ }));
        check(`${label}: a card opens its piece page`, opened && path(page) === PIECE, page.url());
        await page.goBack();
        const backOnCatalog = await shows(heading);
        check(
          `${label}: back returns to /catalog`,
          backOnCatalog && path(page) === '/catalog',
          page.url(),
        );
        await page.goBack();
        const viewerBack = await page
          .waitForSelector(SCENE, { timeout: 30_000 })
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

        lap(`${label}/card`);
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
        // The loading screen (apps/web/src/loading) follows the page's lazy chunk, plays its end and goes.
        check(
          `${label}: the loading screen goes once the page is in`,
          await loadingScreenGone(deep.page).then(
            () => true,
            () => false,
          ),
        );
        await deep.page.reload({ waitUntil: 'networkidle', timeout: 60_000 });
        const reloaded = await pieceHeading.waitFor({ timeout: 30_000 }).then(
          () => true,
          () => false,
        );
        check(`${label}: a reload keeps the piece page`, reloaded && path(deep.page) === PIECE);
        await press(deep.page.getByRole('link', { name: '← Catalogue' }));
        // The URL and the rendered catalogue heading, under load a software render takes its time.
        const backHome = await shows(
          deep.page.getByRole('heading', { level: 1, name: 'Catalogue' }),
        );
        check(
          `${label}: "← Catalogue" keeps the home`,
          backHome && path(deep.page) === '/catalog' && new URL(deep.page.url()).search === query,
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

        lap(`${label}/deep-link`);
      }
      // 6. Every type's piece page: the 3D inspector, dimensions in cm, the section of openings,
      // and the playground (which never writes: see "nothing was written").
      const pages = await open();
      const p = pages.page;
      await p.goto(at('/catalog'), { waitUntil: 'networkidle', timeout: 60_000 });
      onHost(p);
      await p.locator(CARD).first().waitFor({ timeout: 30_000 });
      const types = await p.locator(CARD).evaluateAll((links) =>
        links.map((a) => ({
          id: a.dataset.typeId,
          href: new URL(a.getAttribute('href'), a.baseURI).pathname,
        })),
      );
      lap(`${label}/piece-list`);
      if (
        sharded &&
        [...new Set(types.map((t) => t.id))].sort().join() !== [...new Set(listed)].sort().join()
      )
        throw new Error(
          `${label}: the catalogue lists other types than at the start, a shard would miss some`,
        );
      const cm = /^\d+\.\d cm$/;
      const shot = (name) =>
        out.replace(/\.png$/, `-${name}${device.hasTouch ? '-phone' : ''}.png`);
      for (const { id, href } of types.filter((t) => runs(`${label}/piece/${t.id}`))) {
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
          `${canvas ? SCENE : 'no canvas'}; ${labels.join(', ')}`,
        );
        if (id.startsWith('garden.')) {
          // Outdoor pieces stand on the ground outside; agents place them (Place adds to a room).
          const text = (
            (await p
              .locator('.piece-mounting')
              .textContent()
              .catch(() => '')) ?? ''
          ).trim();
          const kindLine =
            (await p
              .locator('.piece-kind')
              .textContent()
              .catch(() => '')) ?? '';
          await p
            .getByText(/uses? in this environment/)
            .first()
            .waitFor({ timeout: 20_000 })
            .catch(() => {});
          const edit = p.getByRole('switch', { name: 'Edit', exact: true });
          const editable = (await edit.count()) > 0;
          if (editable) await press(edit);
          const place = await p.getByRole('button', { name: 'Place…' }).count();
          if (editable) await press(p.getByRole('switch', { name: 'Edit', exact: true }));
          check(
            `${label}: ${id} is under /catalog/outdoor/, stands on the ground and offers no Place`,
            href === `/catalog/outdoor/${id}` &&
              /^Stands on the ground outside/.test(text) &&
              kindLine.startsWith('Outdoor') &&
              place === 0,
            `${href}; ${kindLine}; ${text}; ${place} Place buttons`,
          );
        }
        const mounted = MOUNTED_TYPES[id];
        if (mounted) {
          const text =
            (await p
              .locator('.piece-mounting')
              .textContent()
              .catch(() => '')) ?? '';
          const kindLine =
            (await p
              .locator('.piece-kind')
              .textContent()
              .catch(() => '')) ?? '';
          check(
            `${label}: ${id} is under /catalog/${mounted.kind}/ and says how it is mounted`,
            href === `/catalog/${mounted.kind}/${id}` &&
              mounted.mounting.test(text.trim()) &&
              kindLine.startsWith(mounted.kind === 'fixtures' ? 'Fixtures' : 'Furniture'),
            `${href}; ${kindLine}; ${text}`,
          );
          // Place is shown once the where-used has loaded, for every placed type.
          await p
            .getByText(/uses? in this environment/)
            .first()
            .waitFor({ timeout: 20_000 })
            .catch(() => {});
          // Placing is edit mode's: a visit starts in view mode, where there is no Place.
          const viewPlace = await p.getByRole('button', { name: 'Place…' }).count();
          check(`${label}: ${id} offers no Place in view mode`, viewPlace === 0, `${viewPlace}`);
          await press(p.getByRole('switch', { name: 'Edit', exact: true }));
          const place = await p.getByRole('button', { name: 'Place…' }).count();
          check(`${label}: ${id} offers Place in edit mode`, place === 1, `${place} Place buttons`);
          await press(p.getByRole('switch', { name: 'Edit', exact: true }));
          if (!device.hasTouch) {
            await p.waitForTimeout(500);
            await p.screenshot({ path: shot(id.replace('.', '-')) });
          }
        }
        if (id.startsWith('window.') || id.startsWith('door.') || id.startsWith('gate.')) {
          if (!device.hasTouch && id === 'window.casement')
            await p.screenshot({ path: shot('window') });
          await press(viewSwitch(p, 'Section'));
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
            await press(viewSwitch(p, '3D'));
            await p
              .locator('.dimension-label')
              .first()
              .waitFor({ timeout: 15_000 })
              .catch(() => {});
            await p.waitForTimeout(500);
            await p.screenshot({ path: shot('door') });
          }
        }
        lap(`${label}/piece/${id}`);
      }

      if (runs(`${label}/catalogue`)) {
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
            // Hit-tested (scene.mjs missedTouches): a compact Sakuga control (the Edit switch) draws a face
            // smaller than 44 px and takes touches 44 px across inside its shadow root (#168 PR 4).
            .evaluateAll(missedTouches, TOUCH);
          check(
            `${label}: piece page controls take a touch at least ${TOUCH} px across`,
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
      }
      check(
        `${label}: no console or page errors on the piece pages`,
        pages.errors.length === 0,
        pages.errors.slice(0, 5).map(redact).join(' | '),
      );
      await pages.context.close();
      lap(`${label}/playground`);

      if (runs(`${label}/catalogue`)) {
        await usesStep({ label, device, open, press, base, homeId, shot });
        lap(`${label}/uses`);
      }
    }
    check(
      'nothing was written: every write was answered in the browser',
      blocked.length === 0,
      blocked.join(', '),
    );
    console.log(`answered in the browser: ${faked.join(', ') || 'nothing'}`);
    console.log(
      `screenshots ${out} ${out.replace(/\.png$/, '-phone.png')} and ${out.replace(/\.png$/, '-*.png')}`,
    );
  } finally {
    await browser.close();
  }
}

/** The type ids the catalogue lists, in its order: what a shard splits (with the screens). */
async function listTypes(browser, host, url) {
  const context = await browser.newContext();
  await context.route('**/*', (route) => {
    const request = route.request();
    if (new URL(request.url()).host !== host) return route.continue();
    if (answeredInfrastructure(route, host)) return;
    if (!['GET', 'HEAD'].includes(request.method())) return route.abort();
    return route.continue({ headers: { ...request.headers(), authorization: `Bearer ${token}` } });
  });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
    if (new URL(page.url()).host !== host)
      throw new Error('ended on another host (login redirect?)');
    await page.locator(CARD).first().waitFor({ timeout: 30_000 });
    return await page.locator(CARD).evaluateAll((cards) => cards.map((c) => c.dataset.typeId));
  } finally {
    await context.close();
  }
}

const WINDOW = 'window.casement';

/** Waits for `fn` (in the page) to be true; false after `timeout` ms. */
const until = (page, fn, arg, timeout = 30_000) =>
  page.waitForFunction(fn, arg, { timeout }).then(
    () => true,
    () => false,
  );

/**
 * 7. The piece page's uses (#45). Where-used of `door.interior` in the first home (read-only), with
 * the catalogue's count. A window's editor opens from `#use=`; on the desktop its Save sends the
 * edit, which the browser answers with an error (nothing is stored), and its history opens
 * read-only. Place on the bed's page, with the POST answered inside the browser: no placement is
 * created. No write ever reaches a deployed environment.
 */
async function usesStep({ label, device, open, press, base, homeId, shot }) {
  const url = (p) => new URL(p, base).href;
  let facts;

  // Where-used, read-only.
  {
    const { context, page, errors } = await open();
    await page.goto(url('/'), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    facts = await page.evaluate(
      async ({ id }) => {
        const homes = (await (await fetch('/api/homes')).json()).items;
        const usage = (await (await fetch('/api/catalog/usage')).json()).counts;
        return {
          home: id ?? homes[0]?.id,
          count: usage['door.interior'],
        };
      },
      { id: homeId ?? null },
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

  // A window of the first home: its editor opens from `#use=`, the edit is sent (the PUT is
  // answered inside the browser with an error: nothing is saved), and the history opens, read-only.
  {
    const puts = [];
    const fake = (method, path, body) => {
      if (method !== 'PUT' || !/^\/api\/homes\/[^/]+\/opening-overrides\/[^/]+$/.test(path))
        return undefined;
      puts.push(JSON.parse(body));
      return {
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'catalog smoke: not saved' }),
      };
    };
    const { context, page, errors } = await open({ fake });
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
      { home: facts.home, type: WINDOW },
    );
    check(`${label}: the home has a ${WINDOW} to open`, picked !== undefined);
    if (picked) {
      const colour = picked.effective.frameColor === '#2a5d8f' ? '#8f2a5d' : '#2a5d8f';
      await page.goto(
        url(`/catalog/openings/${WINDOW}?home=${encodeURIComponent(facts.home)}#use=${picked.id}`),
        { waitUntil: 'networkidle', timeout: 60_000 },
      );
      const row = page.locator(`[id="use-${facts.home}-${picked.id}"]`);
      const editor = page.getByRole('region', { name: `Edit ${picked.name}` });
      // View mode (the default): the use shows its history, with no editor and nothing to undo.
      check(
        `${label}: in view mode #use= opens the history, with no editor, Edit or Undo`,
        (await row
          .getByRole('region', { name: 'History' })
          .waitFor({ timeout: 30_000 })
          .then(
            () => true,
            () => false,
          )) &&
          (await editor.count()) === 0 &&
          (await row.getByRole('button', { name: `Edit ${picked.name}` }).count()) === 0 &&
          (await row.getByRole('button', { name: /^Undo/ }).count()) === 0,
      );
      await press(page.getByRole('switch', { name: 'Edit', exact: true }));
      check(
        `${label}: #use= opens the use's editor`,
        await editor.waitFor({ timeout: 30_000 }).then(
          () => true,
          () => false,
        ),
      );
      if (!device.hasTouch) {
        const hex = editor.getByRole('textbox', { name: 'Frame colour, hex' });
        await hex.fill(colour);
        await hex.blur();
        await press(editor.getByRole('button', { name: 'Save', exact: true }));
        check(
          `${label}: Save sends the edit (answered in the browser, nothing is written)`,
          (await page.waitForTimeout(1500),
          puts.length === 1 && puts[0].params?.frameColor === colour),
          JSON.stringify(puts[0] ?? {}),
        );
        check(
          `${label}: the row still shows the stored overrides`,
          (await row.getByLabel('Overrides').filter({ hasText: colour }).count()) === 0,
        );
      }
      const history = row.getByRole('region', { name: 'History' });
      await press(row.getByRole('button', { name: `History of ${picked.name}` }));
      check(
        `${label}: the history opens (read-only)`,
        await history.waitFor({ timeout: 30_000 }).then(
          () => true,
          () => false,
        ),
      );
      await row.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await row
        .screenshot({ path: shot('history'), timeout: 60_000 })
        .catch((error) => console.log(`no history screenshot: ${redact(error.message)}`));
    }
    check(
      `${label}: no console or page errors while opening the editor`,
      errors.filter((e) => !/status of 500|catalog smoke/.test(e)).length === 0,
      errors.slice(0, 3).map(redact).join(' | '),
    );
    await context.close();
  }

  // Place, with the POST answered in the browser.
  const placeHome = facts.home;
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
    await page
      .getByText(/uses? in this environment/)
      .first()
      .waitFor({ timeout: 20_000 })
      .catch(() => {});
    check(
      `${label}: the bed's page offers no Place in view mode`,
      (await page.getByRole('button', { name: 'Place…' }).count()) === 0,
    );
    await press(page.getByRole('switch', { name: 'Edit', exact: true }));
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
