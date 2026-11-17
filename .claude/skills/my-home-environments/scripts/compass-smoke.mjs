// Run by compass-smoke.sh; not meant to be called directly.
//   node compass-smoke.mjs <out.png> <photo>   (SITE_BASE, SITE_TOKEN from with-site-token.sh)
// Smoke test of the camera modes in walk mode, on a phone-sized screen, with MOCKED orientation
// events: no real device is involved. Manual mode ignores the sensors; Sensor mode follows heading
// and tilt and ignores every drag (only walking). Covers the Android path (absolute alpha), the iOS
// path (webkitCompassHeading after a permission tap), the crossing of north, landscape, the compass
// rose, the fallback to Manual without data, the mode kept over a reload and the sensor snapshot of
// a captured photo.
// Read-only: the upload of that photo is intercepted in the browser and answered here, so nothing
// reaches the environment's photo store and there is nothing to remove afterwards.
// The functions handed to page.evaluate() and addInitScript() run in the page, not in Node:
/* global window, screen, DeviceOrientationEvent */
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.join(process.env.MY_HOME_PLAYWRIGHT_DIR, 'package.json'));
const { chromium } = require('playwright');

const { SITE_BASE: base, SITE_TOKEN: token = '' } = process.env;
const host = new URL(base).host;
const [out, photoFile] = process.argv.slice(2);
const auth = { authorization: `Bearer ${token}` };
const redact = (text) => {
  let safe = String(text).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted-jwt]');
  if (token.length >= 8) safe = safe.split(token).join('[redacted]');
  return safe;
};

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${name}${detail === '' ? '' : `: ${detail}`}`);
  if (!ok) failures.push(name);
};
const deg = (radians) => (radians * 180) / Math.PI;
/** Smallest difference between two angles in degrees. */
const apart = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
const errors = [];

async function open(browser, initScript) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  // The site token goes only to the environment's own host.
  await context.route('**/*', (route) => {
    const request = route.request();
    if (new URL(request.url()).host !== host) return route.continue();
    return route.continue({ headers: { ...request.headers(), ...auth } });
  });
  // No camera in the page: the shutter falls back to the camera-app file input, which takes the
  // synthetic photo (the camera in the page has its own smoke test, camera-smoke.sh).
  await context.addInitScript(() => {
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: undefined,
    });
  });
  await context.addInitScript(initScript);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.goto(new URL('/?walk=first', base).href, {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });
  if (new URL(page.url()).host !== host) throw new Error('ended on another host (login redirect?)');
  const hud = page.locator('[data-testid=walk-hud]');
  await hud.waitFor({ timeout: 60_000 });
  await page.waitForTimeout(4000);

  const read = async () => {
    const data = await hud.evaluate((element) => ({ ...element.dataset }));
    // Plan heading: degrees clockwise from the plan's -z.
    return {
      heading: ((-deg(Number(data.yaw)) % 360) + 360) % 360,
      pitch: deg(Number(data.pitch)),
      x: Number(data.x),
      z: Number(data.z),
      mode: data.mode,
    };
  };
  /** Polls until the view has settled where `done` wants it, or 15 s have passed. */
  const settle = async (done) => {
    const deadline = Date.now() + 15_000;
    let state = await read();
    while (!done(state) && Date.now() < deadline) {
      await page.waitForTimeout(250);
      state = await read();
    }
    return state;
  };
  /** A mocked sensor event, dispatched as the browser would. */
  const send = (type, init) =>
    page.evaluate(
      ([type, init]) => {
        const { webkitCompassHeading, webkitCompassAccuracy, ...rest } = init;
        const event = new DeviceOrientationEvent(type, rest);
        const define = (name, value) =>
          value !== undefined && Object.defineProperty(event, name, { value });
        define('webkitCompassHeading', webkitCompassHeading);
        define('webkitCompassAccuracy', webkitCompassAccuracy);
        window.dispatchEvent(event);
      },
      [type, init],
    );
  /** Android: the phone upright in portrait, its camera facing `bearing`, tilted to `beta`. */
  const face = (bearing, beta = 90) =>
    send('deviceorientationabsolute', {
      alpha: (360 - bearing) % 360,
      beta,
      gamma: 0,
      absolute: true,
    });
  const screenAngle = (angle) =>
    page.evaluate((angle) => {
      Object.defineProperty(screen.orientation, 'angle', { configurable: true, get: () => angle });
    }, angle);
  const button = (name) => page.getByRole('button', { name });
  const mode = (name) => page.getByRole('radio', { name });
  /** A mouse drag on the view from the middle of the screen by (dx, dy). */
  const drag = async (dx, dy) => {
    await page.mouse.move(195, 420);
    await page.mouse.down();
    await page.mouse.move(195 + dx, 420 + dy, { steps: 5 });
    await page.mouse.up();
  };
  return { page, context, hud, read, settle, send, face, screenAngle, button, mode, drag };
}

async function android(browser, home) {
  console.log('--- Android path: absolute alpha, no permission prompt');
  const north = home.building.northBearing?.value ?? 0;
  const declination = home.building.magneticDeclination?.value ?? 0;
  const plan = (bearing) => bearing + declination + north;
  // Chromium has the permission function but refuses it without a device; Android Chrome grants it.
  const s = await open(browser, () => {
    DeviceOrientationEvent.requestPermission = () => Promise.resolve('granted');
  });
  const start = await s.read();

  // Manual mode, the default: the sensors are not listened to at all.
  check(
    'it starts in Manual mode, with one Sensors/Manual switch',
    start.mode === 'manual' &&
      (await s.mode(/Manual/).getAttribute('aria-checked')) === 'true' &&
      (await s.button(/Heading|Tilt o/).count()) === 0,
  );
  for (const [bearing, beta] of [
    [90, 60],
    [200, 120],
  ])
    await s.face(bearing, beta);
  await s.page.waitForTimeout(1500);
  const ignored = await s.read();
  check(
    'Manual mode: mocked orientation events change nothing',
    apart(ignored.heading, start.heading) < 0.3 && Math.abs(ignored.pitch - start.pitch) < 0.3,
  );
  await s.button('Look up').click();
  const looked = await s.settle((v) => Math.abs(v.pitch - start.pitch - 10) < 1);
  await s.drag(35, 0);
  const turned = await s.settle((v) => apart(v.heading, start.heading + 10) < 3);
  check(
    'Manual mode: ▲ and a drag turn the view',
    Math.abs(looked.pitch - start.pitch - 10) < 1 && apart(turned.heading, start.heading + 10) < 3,
  );

  // Sensor mode: heading and tilt from the phone.
  await s.mode(/Sensors/).click();
  await s.face(0, 60);
  const down = await s.settle((v) => Math.abs(v.pitch + 30) < 3 && apart(v.heading, plan(0)) < 3);
  check(
    'Sensor mode: tipping the phone down 30° looks down',
    Math.abs(down.pitch + 30) < 3,
    `${down.pitch.toFixed(1)}°`,
  );
  await s.face(0, 115);
  const up = await s.settle((v) => Math.abs(v.pitch - 25) < 3);
  check(
    'Sensor mode: tipping it up 25° looks up',
    Math.abs(up.pitch - 25) < 3,
    `${up.pitch.toFixed(1)}°`,
  );
  check('Sensor mode: the ▲▼ buttons are hidden', (await s.button('Look up').count()) === 0);
  await s.page.screenshot({ path: out.replace(/\.png$/, '-tilt-up.png'), timeout: 120_000 });

  // Heading from the compass.
  const seen = [];
  for (const bearing of [0, 90, 180, 270]) {
    await s.face(bearing);
    const view = await s.settle((v) => apart(v.heading, plan(bearing)) < 3);
    seen.push(`${bearing}->${view.heading.toFixed(1)}`);
    check(
      `heading: bearing ${bearing}° faces plan heading ${plan(bearing)}°`,
      apart(view.heading, plan(bearing)) < 3,
    );
  }
  console.log(
    `      (bearing -> plan heading: ${seen.join(', ')}; north ${north}°, declination ${declination}°)`,
  );

  // Across north: 350 -> 358 -> 2 -> 10, never the long way round.
  await s.face(350);
  let previous = await s.settle((v) => apart(v.heading, plan(350)) < 3);
  let smooth = true;
  for (const bearing of [358, 2, 10]) {
    await s.face(bearing);
    const view = await s.settle((v) => apart(v.heading, plan(bearing)) < 3);
    if (apart(view.heading, previous.heading) > 14 || apart(view.heading, plan(bearing)) > 3)
      smooth = false;
    previous = view;
  }
  check('north is crossed the short way, in small steps', smooth);

  // Jitter inside the dead-band does not move the view.
  await s.face(90);
  await s.settle((v) => apart(v.heading, plan(90)) < 3);
  // Let the view come to rest before judging whether it moves.
  await s.page.waitForTimeout(1500);
  const still = await s.read();
  for (const wobble of [91, 89.2, 90.6]) await s.face(wobble);
  await s.page.waitForTimeout(1200);
  check(
    '±1° of jitter does not move the view',
    apart((await s.read()).heading, still.heading) < 0.3,
  );

  // A relative event is never used as a compass.
  await s.send('deviceorientation', { alpha: 200, beta: 90, gamma: 0, absolute: false });
  await s.page.waitForTimeout(1200);
  check(
    'a relative alpha is not used as a compass',
    apart((await s.read()).heading, still.heading) < 0.3,
  );

  // Landscape, top of the device to the left, camera level and facing north.
  await s.screenAngle(90);
  await s.send('deviceorientationabsolute', { alpha: 90, beta: 0, gamma: -90, absolute: true });
  const landscape = await s.settle((v) => apart(v.heading, plan(0)) < 3 && Math.abs(v.pitch) < 3);
  check(
    'landscape faces where the camera points',
    apart(landscape.heading, plan(0)) < 3,
    `${landscape.heading.toFixed(1)}°`,
  );
  check(
    'landscape, camera level: pitch 0',
    Math.abs(landscape.pitch) < 3,
    `${landscape.pitch.toFixed(1)}°`,
  );
  await s.screenAngle(0);

  // The compass rose in first person.
  const rose = () =>
    s.page.locator('.compass').evaluate((e) => parseFloat(e.style.getPropertyValue('--rose')));
  await s.face(0);
  await s.settle((v) => apart(v.heading, plan(0)) < 3);
  await s.page.waitForTimeout(600);
  const roseNorth = await rose();
  await s.face(90);
  await s.settle((v) => apart(v.heading, plan(90)) < 3);
  await s.page.waitForTimeout(600);
  const roseEast = await rose();
  check(
    'the compass rose turns with the figure in first person',
    apart(roseNorth - roseEast, 90) < 4,
    `${roseNorth.toFixed(0)}° -> ${roseEast.toFixed(0)}°`,
  );

  // A photo taken now stores the sensor snapshot.
  await s.face(90, 75);
  const shot = await s.settle((v) => Math.abs(v.pitch + 15) < 3 && apart(v.heading, plan(90)) < 3);
  await s.page.locator('.shutter input').setInputFiles(photoFile);
  await s.page.getByLabel('Note').fill('compass-smoke: not stored');
  // The upload never leaves the browser: it is caught here, its `meta` part is read, and the page
  // gets the answer the api would give. Nothing is stored.
  let meta;
  await s.page.route('**/api/homes/*/photos', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.continue();
    const body = request.postDataBuffer()?.toString('utf8') ?? '';
    meta = JSON.parse(/name="meta"\r\n\r\n([\s\S]*?)\r\n--/.exec(body)?.[1] ?? 'null');
    const image = { contentType: 'image/webp', width: 320, height: 240, byteSize: 1 };
    const now = new Date().toISOString();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'compass-smoke-not-stored',
        homeId: home.id,
        levelId: meta?.levelId ?? null,
        pose: meta?.pose,
        capturedRoomId: null,
        capturedRoomName: null,
        capturedRoomStatus: 'none',
        room: null,
        levelInModel: true,
        takenAt: meta?.takenAt ?? now,
        note: meta?.note ?? '',
        tags: meta?.tags ?? [],
        requestId: null,
        image,
        thumbnail: image,
        sensors: meta?.sensors ?? null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        purgeAt: null,
      }),
    });
  });
  await s.button('Save photo').click();
  await s.page.getByText('Photo saved').waitFor({ timeout: 30_000 });
  await s.page.unroute('**/api/homes/*/photos');
  const photo = meta ?? {};
  const sensors = photo.sensors ?? {};
  check('the upload carries the pose and a sensor snapshot', Boolean(meta?.pose && meta?.sensors));
  check(
    'its snapshot says the heading was measured',
    sensors.source === 'sensor',
    JSON.stringify(sensors.source),
  );
  check(
    'the snapshot has the raw angles and what was applied',
    sensors.alpha === 270 &&
      sensors.beta === 75 &&
      sensors.absolute === true &&
      sensors.tilt === true &&
      sensors.declination === declination &&
      typeof sensors.calibrationOffset === 'number' &&
      sensors.screenAngle === 0,
  );
  check(
    "the stored pose is the sensors' view",
    Math.abs(deg(photo.pose.pitch) - shot.pitch) < 1 &&
      apart(-deg(photo.pose.yaw), shot.heading) < 1,
    `pitch ${deg(photo.pose.pitch).toFixed(1)}°`,
  );
  check(
    'nothing in the snapshot says where the phone is',
    !/lat|lon|coord|position|gps/i.test(Object.keys(sensors).join(' ')),
  );
  await s.button('Done').click();

  // With the sheet closed the sensors listen afresh: the next event has the phone drive the view.
  await s.face(90, 75);
  await s.settle((v) => apart(v.heading, plan(90)) < 3);
  await s.page.waitForTimeout(1500);
  // Sensor mode is walking only: no drag turns or tilts the view, nor corrects the compass.
  const before = await s.read();
  await s.drag(35, 0);
  await s.drag(0, -120);
  await s.drag(-80, 90);
  await s.page.waitForTimeout(1200);
  const after = await s.read();
  check(
    'Sensor mode: mocked drags change neither yaw nor pitch',
    apart(after.heading, before.heading) < 0.3 && Math.abs(after.pitch - before.pitch) < 0.3,
    `${before.heading.toFixed(1)}° -> ${after.heading.toFixed(1)}°`,
  );
  check('and no offset appears', !/offset/.test(await s.page.locator('.walk-bar').innerText()));
  // The pad's left and right sidestep; nothing turns.
  const pad = await s.page.getByRole('application', { name: 'Movement pad' }).boundingBox();
  const cx = pad.x + pad.width / 2;
  const cy = pad.y + pad.height / 2;
  await s.page.mouse.move(cx, cy);
  await s.page.mouse.down();
  await s.page.mouse.move(cx + 44, cy, { steps: 3 });
  const stepped = await s.settle((v) => Math.hypot(v.x - before.x, v.z - before.z) > 0.3);
  await s.page.mouse.up();
  check(
    "Sensor mode: the pad's right sidesteps and does not turn",
    Math.hypot(stepped.x - before.x, stepped.z - before.z) > 0.3 &&
      apart(stepped.heading, before.heading) < 1,
    `moved ${Math.hypot(stepped.x - before.x, stepped.z - before.z).toFixed(2)} m`,
  );
  await s.page.screenshot({ path: out, timeout: 120_000 });

  // The mode is kept over a reload, and comes back on by itself where no permission is asked.
  await s.page.reload({ waitUntil: 'networkidle', timeout: 60_000 });
  await s.hud.waitFor({ timeout: 60_000 });
  // The phone keeps reporting its orientation, as a real one does: without any data Sensor mode
  // falls back to Manual after 2 s, so a read that comes late must not find it silent.
  let restored = await s.read();
  for (const deadline = Date.now() + 15_000; Date.now() < deadline;) {
    await s.face(90);
    restored = await s.read();
    if (restored.mode === 'sensors' && apart(restored.heading, plan(90)) < 3) break;
    await s.page.waitForTimeout(250);
  }
  check(
    'after a reload Sensor mode is back on and follows the phone',
    restored.mode === 'sensors' && apart(restored.heading, plan(90)) < 3,
    `${restored.mode}, ${restored.heading.toFixed(1)}°`,
  );
  await s.mode(/Manual/).click();
  await s.page.waitForTimeout(500);
  const manual = await s.read();
  await s.face(250, 40);
  await s.page.waitForTimeout(1500);
  const unmoved = await s.read();
  check(
    'back in Manual mode the phone no longer moves the view',
    apart(unmoved.heading, manual.heading) < 0.3 && Math.abs(unmoved.pitch - manual.pitch) < 0.3,
  );
  await s.context.close();
}

async function ios(browser, home) {
  console.log('--- iOS path: permission from a tap, webkitCompassHeading');
  const north = home.building.northBearing?.value ?? 0;
  const declination = home.building.magneticDeclination?.value ?? 0;
  const plan = (bearing) => bearing + declination + north;
  const s = await open(browser, () => {
    window.__asked = 0;
    window.__answer = 'denied';
    DeviceOrientationEvent.requestPermission = () => {
      window.__asked++;
      return Promise.resolve(window.__answer);
    };
  });
  check(
    'no permission is requested before a tap',
    (await s.page.evaluate(() => window.__asked)) === 0,
  );
  await s.mode(/Sensors/).click();
  await s.page.waitForTimeout(800);
  const notice = await s.page
    .locator('.walk-bar .walk-notice')
    .innerText()
    .catch(() => '');
  check(
    'a refusal is reported and the view stays in Manual mode',
    /did not allow/.test(notice) && (await s.read()).mode === 'manual',
    notice,
  );
  await s.button('Look up').click();
  await s.button('Look up').click();
  const manual = await s.settle((v) => Math.abs(v.pitch - 20) < 1);
  check(
    'after a refusal, looking up by hand still works',
    Math.abs(manual.pitch - 20) < 1,
    `${manual.pitch.toFixed(1)}°`,
  );

  await s.page.evaluate(() => {
    window.__answer = 'granted';
  });
  await s.mode(/Sensors/).click();
  await s.page.waitForTimeout(800);
  check(
    'a granted permission switches Sensor mode on',
    (await s.page.evaluate(() => window.__asked)) === 2 && (await s.read()).mode === 'sensors',
  );
  // On iOS alpha is not earth-referenced; the heading comes from webkitCompassHeading.
  const safari = (heading, beta = 90) =>
    s.send('deviceorientation', {
      alpha: 42,
      beta,
      gamma: 0,
      absolute: false,
      webkitCompassHeading: heading,
      webkitCompassAccuracy: 15,
    });
  await safari(120, 70);
  const view = await s.settle((v) => apart(v.heading, plan(120)) < 3 && Math.abs(v.pitch + 20) < 3);
  check(
    'the Safari heading turns the figure',
    apart(view.heading, plan(120)) < 3,
    `${view.heading.toFixed(1)}°`,
  );
  check('and its tilt sets the pitch', Math.abs(view.pitch + 20) < 3, `${view.pitch.toFixed(1)}°`);
  check('the accuracy is shown', (await s.page.locator('.walk-bar').innerText()).includes('±15°'));
  await s.screenAngle(90);
  await s.send('deviceorientation', {
    alpha: 42,
    beta: 0,
    gamma: -90,
    absolute: false,
    webkitCompassHeading: 120,
    webkitCompassAccuracy: 15,
  });
  const landscape = await s.settle((v) => apart(v.heading, plan(210)) < 3);
  check(
    'landscape: the Safari heading is corrected by the screen angle',
    apart(landscape.heading, plan(210)) < 3,
    `${landscape.heading.toFixed(1)}°`,
  );
  await s.page.screenshot({ path: out.replace(/\.png$/, '-ios.png'), timeout: 120_000 });

  // No data at all: back to Manual with a message.
  await s.mode(/Manual/).click();
  await s.mode(/Sensors/).click();
  const fallen = await s.settle((v) => v.mode === 'manual');
  const silent = await s.page
    .locator('.walk-bar .walk-notice')
    .innerText()
    .catch(() => '');
  check(
    'without sensor data it falls back to Manual and says so',
    fallen.mode === 'manual' && /No motion sensor data/.test(silent),
    silent,
  );
  await s.context.close();
}

const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  // Reading only: the homes, for the north bearing and the declination to expect.
  const api = async (pathname) => {
    const response = await fetch(base + pathname, { redirect: 'manual', headers: auth });
    if (!response.ok) throw new Error(`GET ${pathname}: HTTP ${response.status}`);
    return response.json();
  };
  const homes = await api('/api/homes');
  const home = await api(`/api/homes/${homes.items[0].id}`);
  await android(browser, home);
  await ios(browser, home);
  check(
    'no console or page errors',
    errors.length === 0,
    errors.slice(0, 5).map(redact).join(' | '),
  );
  console.log(`screenshots ${out} (and -tilt-up, -ios)`);
} catch (error) {
  console.error(`FAILED: ${redact(error.message)}`);
  failures.push('the run itself');
} finally {
  await browser.close();
}
console.log(failures.length ? `FAILED: ${failures.join('; ')}` : 'compass smoke test passed');
process.exit(failures.length ? 1 : 0);
