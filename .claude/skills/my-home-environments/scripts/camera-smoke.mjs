// Run by camera-smoke.sh; not meant to be called directly.
//   node camera-smoke.mjs <out.png>   (SITE_BASE, SITE_TOKEN from with-site-token.sh)
// Smoke test of taking a photo in walk mode at phone size with Chromium's FAKE camera: the camera inside
// the page, the fallback to the camera app and the gallery, and the way back after a reload while the
// camera app was open. Each upload is parsed and checked, then answered here: nothing reaches the
// environment's photo store, and every other write is refused in the browser.
// The functions handed to page.evaluate() and addInitScript() run in the page, not in Node:
/* global window, document */
import { createRequire } from 'node:module';
import path from 'node:path';
import { answeredInfrastructure } from './infrastructure.mjs';

const require = createRequire(path.join(process.env.MY_HOME_PLAYWRIGHT_DIR, 'package.json'));
const { chromium } = require('playwright');

const { SITE_BASE: base, SITE_TOKEN: token = '' } = process.env;
const host = new URL(base).host;
const out = process.argv[2];
const redact = (text) => {
  let safe = String(text).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted-jwt]');
  if (token.length >= 8) safe = safe.split(token).join('[redacted]');
  return safe;
};

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${name}${detail === '' ? '' : `: ${redact(detail)}`}`);
  if (!ok) failures.push(name);
};
const errors = [];

/** The parts of a multipart/form-data body, by field name. */
function parseMultipart(body, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType ?? '');
  const parts = {};
  if (!boundary || !body) return parts;
  const marker = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let start = body.indexOf(marker);
  while (start !== -1) {
    const next = body.indexOf(marker, start + marker.length);
    if (next === -1) break;
    const part = body.subarray(start + marker.length + 2, next - 2);
    const split = part.indexOf('\r\n\r\n');
    const head = part.subarray(0, split).toString('utf8');
    const name = /name="([^"]*)"/.exec(head)?.[1];
    if (name) {
      parts[name] = {
        type: /content-type:\s*([^\r\n]+)/i.exec(head)?.[1],
        data: part.subarray(split + 4),
      };
    }
    start = next;
  }
  return parts;
}

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/** Checks one intercepted upload; returns the answer the api would give. */
function checkUpload(label, request, homeId) {
  const parts = parseMultipart(request.postDataBuffer(), request.headers()['content-type']);
  let meta;
  try {
    meta = JSON.parse(parts.meta?.data.toString('utf8') ?? '');
  } catch {
    meta = undefined;
  }
  const pose = meta?.pose;
  check(
    `${label}: the "meta" part has a valid pose`,
    Boolean(
      pose &&
      ['x', 'y', 'z'].every((k) => finite(pose.position?.[k])) &&
      finite(pose.yaw) &&
      finite(pose.pitch) &&
      Math.abs(pose.pitch) <= Math.PI / 2 &&
      (pose.fovH === undefined || (pose.fovH > 0 && pose.fovH < Math.PI)) &&
      typeof meta.takenAt === 'string' &&
      meta.sensors?.source,
    ),
    JSON.stringify(pose),
  );
  const image = parts.image?.data ?? Buffer.alloc(0);
  check(
    `${label}: the "image" part is a JPEG of a sensible size`,
    image.length > 1000 &&
      image.length < 25 * 1024 * 1024 &&
      image[0] === 0xff &&
      image[1] === 0xd8 &&
      /^image\/jpeg/.test(parts.image?.type ?? ''),
    `${parts.image?.type}, ${image.length} bytes`,
  );
  const now = new Date().toISOString();
  const stored = { contentType: 'image/webp', width: 320, height: 240, byteSize: 1 };
  return {
    id: `camera-smoke-${label}-not-stored`.replace(/\W+/g, '-'),
    homeId,
    levelId: meta?.levelId ?? null,
    pose,
    capturedRoomId: null,
    capturedRoomName: null,
    capturedRoomStatus: 'none',
    room: null,
    levelInModel: true,
    takenAt: meta?.takenAt ?? now,
    note: meta?.note ?? '',
    tags: meta?.tags ?? [],
    requestId: null,
    image: stored,
    thumbnail: stored,
    sensors: meta?.sensors ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    purgeAt: null,
  };
}

async function open(browser, label, { denyCamera = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  if (!denyCamera) await context.grantPermissions(['camera'], { origin: base });
  const uploads = [];
  await context.route('**/*', (route) => {
    const request = route.request();
    if (new URL(request.url()).host !== host) return route.continue();
    // Cloudflare's own requests (its analytics beacon) are answered here: no write, no error.
    if (answeredInfrastructure(route, host)) return;
    if (request.method() === 'POST' && /\/api\/homes\/[^/]+\/photos$/.test(request.url())) {
      const homeId = decodeURIComponent(request.url().split('/').at(-2));
      const photo = checkUpload(`${label} #${uploads.length + 1}`, request, homeId);
      uploads.push(photo);
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(photo),
      });
    }
    // Read-only: no other write leaves the browser.
    if (!['GET', 'HEAD'].includes(request.method())) return route.abort();
    return route.continue({ headers: { ...request.headers(), authorization: `Bearer ${token}` } });
  });
  if (denyCamera) {
    await context.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException('refused', 'NotAllowedError'));
    });
  }
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${label}: pageerror: ${error.message}`));
  await page.goto(new URL('/?walk=first&hints=off', base).href, {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });
  if (new URL(page.url()).host !== host) throw new Error('ended on another host (login redirect?)');
  await page.locator('[data-testid=walk-hud]').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(3000);
  return { context, page, uploads };
}

/** A synthetic 12 MP JPEG, drawn in the page: no photo file is involved. */
async function syntheticJpeg(page) {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4032;
    canvas.height = 3024;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#6a8caf');
    gradient.addColorStop(1, '#d9c7a3');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return window.btoa(text);
  });
  return { name: 'camera.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(base64, 'base64') };
}

const saved = async (page) => {
  await page.getByRole('button', { name: 'Save photo' }).tap();
  return page
    .getByText('Photo saved')
    .waitFor({ timeout: 60_000 })
    .then(
      () => true,
      () => false,
    );
};

async function smoke() {
  const browser = await chromium.launch({
    args: [
      '--no-sandbox',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  });
  try {
    // 1. The camera inside the page: the page never goes to the background.
    {
      const { context, page, uploads } = await open(browser, 'in-page camera');
      await page.getByRole('button', { name: 'Take photo' }).tap();
      const shutter = page.getByRole('button', { name: 'Take the photo' });
      await page
        .waitForFunction(() => !document.querySelector('.camera-shutter')?.disabled, null, {
          timeout: 20_000,
        })
        .catch(() => undefined);
      const size = await page
        .locator('.camera-view video')
        .evaluate((video) => [video.videoWidth, video.videoHeight]);
      check('the viewfinder shows the camera', size[0] > 0 && size[1] > 0, size.join('x'));
      check('the shutter is ready once the camera runs', await shutter.isEnabled());
      await shutter.tap();
      await page.getByRole('region', { name: 'New photo' }).waitFor({ timeout: 20_000 });
      await page.getByLabel('Note').fill('camera-smoke: not stored');
      check('the photo of the page camera is saved', await saved(page));
      check('exactly one upload was sent', uploads.length === 1, String(uploads.length));
      await context.close();
    }

    // 2. The camera not allowed: the camera app and the gallery still work.
    {
      const { context, page, uploads } = await open(browser, 'camera app', { denyCamera: true });
      await page.getByRole('button', { name: 'Take photo' }).tap();
      const alert = await page
        .locator('.camera-view [role=alert]')
        .textContent({ timeout: 15_000 })
        .catch(() => '');
      check('a refused camera is explained', /not allowed/.test(alert), alert);
      await page.getByLabel('Camera app').setInputFiles(await syntheticJpeg(page));
      await page.getByRole('region', { name: 'New photo' }).waitFor({ timeout: 20_000 });
      check('the photo of the camera app is saved', await saved(page));
      await page.getByRole('button', { name: 'Done' }).tap();
      await page.getByRole('button', { name: 'Take photo' }).tap();
      await page.getByLabel('Gallery').setInputFiles(await syntheticJpeg(page));
      await page.getByRole('region', { name: 'New photo' }).waitFor({ timeout: 20_000 });
      check('a photo from the gallery is saved', await saved(page));
      check('two uploads were sent', uploads.length === 2, String(uploads.length));
      await context.close();
    }

    // 3. The browser drops the tab while the camera app is open, and loads it again.
    {
      const { context, page } = await open(browser, 'reload', { denyCamera: true });
      const hud = page.locator('[data-testid=walk-hud]');
      await page.getByRole('button', { name: 'Overview' }).tap();
      // Away from the start, so that coming back there would not pass for a restored pose.
      const start = await hud.evaluate((element) => ({ ...element.dataset }));
      await page.keyboard.down('w');
      await page.waitForTimeout(800);
      await page.keyboard.up('w');
      await page.keyboard.down('a');
      await page.waitForTimeout(400);
      await page.keyboard.up('a');
      await page.waitForTimeout(500);
      const moved = await hud.evaluate((element) => ({ ...element.dataset }));
      check('the figure walked before the photo', moved.x !== start.x || moved.z !== start.z);
      await page.getByRole('button', { name: 'Take photo' }).tap();
      const chooser = page.waitForEvent('filechooser', { timeout: 15_000 });
      await page.locator('label.camera-alt', { hasText: 'Camera app' }).tap();
      await chooser;
      const before = await hud.evaluate((element) => ({ ...element.dataset }));
      await page.reload({ waitUntil: 'networkidle', timeout: 60_000 });
      const back = await hud.waitFor({ timeout: 60_000 }).then(
        () => true,
        () => false,
      );
      check('walk mode is back after the reload', back);
      if (back) {
        const after = await hud.evaluate((element) => ({ ...element.dataset }));
        check(
          'the figure is back where the shutter was tapped',
          ['x', 'z', 'yaw', 'level'].every((k) => before[k] === after[k]),
          `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
        );
        check(
          'the overview is back',
          await page.getByRole('button', { name: 'First person' }).isVisible(),
        );
        const notice =
          (await page
            .getByRole('alert')
            .textContent()
            .catch(() => '')) ?? '';
        check('the lost photo is explained', /please take it again/.test(notice), notice);
      }
      await page.screenshot({ path: out, timeout: 60_000 }).catch(() => undefined);
      await context.close();
    }
    check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
    console.log(`screenshot ${out}`);
  } finally {
    await browser.close();
  }
}

smoke().then(
  () => {
    console.log(failures.length ? `FAILED: ${failures.join('; ')}` : 'camera smoke test passed');
    process.exit(failures.length ? 1 : 0);
  },
  (error) => {
    console.error(`FAILED: ${redact(error.message)}`);
    process.exit(1);
  },
);
