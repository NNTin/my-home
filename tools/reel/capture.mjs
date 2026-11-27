import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import timeline from './timeline.json' with { type: 'json' };

const [tempDir, ...only] = process.argv.slice(2);
if (!tempDir) throw new Error('Usage: npm run capture -- <temporary directory> [shot...]');

const repo = fileURLToPath(new URL('../../', import.meta.url));
const temp = await realpath(tempDir);
if (temp === path.resolve(repo) || temp.startsWith(repo)) {
  throw new Error('Keep reel media outside the repository.');
}
const out = path.join(temp, 'frames');
const revisions = process.env.REEL_REVISIONS_DIR ?? path.join(temp, 'revisions');
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const date = '2026-01-01T00:00:00.000Z';
const port = 43153;
const base = 'http://127.0.0.1:' + port;
const { size, fps, shots } = timeline;
const shotFrames = (id) => shots.find((shot) => shot.id === id).frames;
const sample = process.env.REEL_SAMPLE_FRAMES?.split(',').map(Number);
if (sample?.some((frame) => !Number.isInteger(frame) || frame < 0)) {
  throw new Error('Pass comma-separated nonnegative frame indices in REEL_SAMPLE_FRAMES.');
}
const names = shots.map(({ id }) => id);
if (only.some((name) => !names.includes(name))) throw new Error('Unknown shot: ' + only.join(', '));
const withShot = (name) => only.length === 0 || only.includes(name);
const cameraHook = await readFile(new URL('./capture/ReelCamera.tsx', import.meta.url), 'utf8');

await mkdir(out, { recursive: true, mode: 0o700 });

function shell(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'inherit' });
}

async function checkout(rev) {
  const dir = path.join(revisions, rev);
  await mkdir(dir, { recursive: true });
  const archived = execFileSync(
    'git',
    [
      'archive',
      rev,
      'apps/web',
      'packages/shared',
      'data/homes',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'tsconfig.base.json',
    ],
    { cwd: repo, maxBuffer: 40 * 1024 * 1024 },
  );
  execFileSync('tar', ['-xf', '-', '-C', dir], { input: archived });
  const web = path.join(dir, 'apps/web');
  const vite = path.join(web, 'node_modules/vite/bin/vite.js');
  try {
    await readFile(vite);
  } catch {
    shell('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], dir);
  }
  const scene = path.join(web, 'src/scene/Scene.tsx');
  const source = await readFile(scene, 'utf8');
  const frameLoop = source.includes('<FrameLoop');
  const anchor = frameLoop ? '<FrameView frame={frame} />' : '</Canvas>';
  const withoutMarkers = source.replace(/<CompassMarkers[\s\S]*?\/>/, '');
  await writeFile(path.join(web, 'src/scene/ReelCamera.tsx'), cameraHook);
  await writeFile(
    scene,
    "import { ReelCamera } from './ReelCamera';\n" +
      withoutMarkers.replace(
        anchor,
        '<ReelCamera frameLoop={' + frameLoop + '} />\n          ' + anchor,
      ),
  );
  if (frameLoop) {
    const file = path.join(web, 'src/scene/Frame.tsx');
    const code = await readFile(file, 'utf8');
    const draw = 'output.render(scene, camera, tier);';
    const pending = code.includes('finishSet.textures.pending')
      ? ', finishSet.textures.pending'
      : '';
    if (!code.includes(draw)) throw new Error('Could not locate the archived frame renderer.');
    await writeFile(
      file,
      "import { recordReelDraw } from './ReelCamera';\n" +
        code.replace(draw, draw + '\n    recordReelDraw(tier' + pending + ');'),
    );
  }
  if (frameLoop) {
    // Use the viewer's FXAA path when capturing on the software GPU. Geometry and textures
    // still render at the delivery size, with the archived lighting and occlusion pass.
    const outputFile = path.join(web, 'src/scene/output.ts');
    const output = await readFile(outputFile, 'utf8');
    await writeFile(outputFile, output.replace("tier === 'fast' && phone ? 0 : 4", '0'));
    if (rev === 'e49f812' || rev === '6820266') {
      const aoFile = path.join(web, 'src/beautiful/render-beautiful.ts');
      const ao = await readFile(aoFile, 'utf8');
      await writeFile(
        aoFile,
        ao
          .replace('halfRes = phone', 'halfRes = true')
          .replace('aoSamples = SAMPLES', 'aoSamples = 16')
          .replace('denoiseSamples = DENOISE_SAMPLES', 'denoiseSamples = 8'),
      );
    }
  }
  if (rev === '6820266') {
    const sectionFile = path.join(web, 'src/views/SectionCut.tsx');
    const section = await readFile(sectionFile, 'utf8');
    const move = '    cut.move([nx, ny, nz], constant);\n    frame?.castersChanged();';
    if (!section.includes(move)) throw new Error('Could not locate the section plane update.');
    await writeFile(
      sectionFile,
      section.replace(
        move,
        move + '\n    document.documentElement.dataset.reelSectionAt = String(view.at);',
      ),
    );
  }
  if (['287cc95', 'e49f812', '6820266'].includes(rev)) {
    const file = path.join(web, 'src/lighting/sceneLights.ts');
    const light = await readFile(file, 'utf8');
    const mode = "const reelMode = new URLSearchParams(location.search).get('reelMode');\n";
    const tune = light
      .replace(
        'const casting = shadowLamps(phone);',
        "const casting = reelMode === 'outdoor' ? 0 : shadowLamps(phone);",
      )
      .replace(
        'length: poolSize(phone)',
        "length: reelMode === 'outdoor' ? 0 : reelMode === 'walk' ? 9 : 4",
      )
      .replace(
        'const inSight = eye',
        "const inSight = reelMode === 'walk' ? " +
          "(e: Emitter) => e.roomId === 'souterrain-kitchen' || e.roomId === 'souterrain-corridor' : eye",
      );
    await writeFile(file, mode + tune);
  }
  return { dir, web, vite };
}

async function withViewer(rev, modelFile, run) {
  const { dir, web, vite } = await checkout(rev);
  const model = await readJson(path.join(dir, 'data/homes', modelFile));
  const prefix = '/api/homes/' + model.id;
  let seed = { placements: [], openingOverrides: [] };
  try {
    seed = await readJson(path.join(dir, 'data/homes', 'home.seed.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const server = spawn(
    process.execPath,
    [vite, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: web, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let startup = '';
  server.stdout.on('data', (chunk) => {
    startup += chunk;
  });
  server.stderr.on('data', (chunk) => {
    startup += chunk;
  });
  const context = await browser.newContext({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(rev + ' page error: ' + error.message));
  const canvas = page.locator('canvas').first();

  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.host !== new URL(base).host || route.request().method() !== 'GET') {
      return route.abort();
    }
    const responses = {
      '/api/homes': {
        items: [
          {
            id: model.id,
            name: model.name,
            schemaVersion: model.schemaVersion,
            createdAt: date,
            updatedAt: date,
          },
        ],
      },
      [prefix]: model,
      [prefix + '/placements']: {
        items: seed.placements.map((item) => ({
          ...item,
          homeId: model.id,
          roomId: item.roomId ?? null,
          version: 1,
          createdAt: date,
          updatedAt: date,
          removedAt: null,
          purgeAt: null,
        })),
      },
      [prefix + '/opening-overrides']: {
        items: seed.openingOverrides.map((item) => ({
          ...item,
          homeId: model.id,
          version: 1,
          updatedAt: date,
        })),
      },
      [prefix + '/settings']: {
        homeId: model.id,
        magneticDeclination: null,
        version: 0,
        updatedAt: null,
      },
      [prefix + '/photos']: { items: [], total: 0 },
    };
    return route.fulfill({ json: responses[url.pathname] ?? { items: [] } });
  });

  async function open(query = '', walkStart) {
    if (walkStart) {
      await page.addInitScript((figure) => {
        sessionStorage.setItem(
          'my-home.walk.session',
          JSON.stringify({
            homeId: 'home',
            view: 'first',
            mode: 'manual',
            savedAt: Date.now(),
            figure: { ...figure, levelId: 'souterrain' },
          }),
        );
      }, walkStart);
    }
    await page.goto(base + '/?hints=off&stepdown=off&' + query, { waitUntil: 'networkidle' });
    try {
      await page.waitForFunction(() => typeof globalThis.__reelCapture === 'function', null, {
        timeout: 60_000,
      });
    } catch (error) {
      console.log((await page.locator('body').innerText()).slice(0, 700));
      throw error;
    }
    const dimensions = await canvas.evaluate((node) => [node.width, node.height]);
    if (dimensions.some((value) => value !== size)) {
      throw new Error('Unexpected canvas dimensions: ' + dimensions.join('×'));
    }
  }

  async function shot(file, { pose = null, tier = 'fast', time = 0 } = {}) {
    const data = await page.evaluate(
      ({ pose, tier, size, time }) => globalThis.__reelCapture(pose, tier, size, time),
      { pose, tier, size, time },
    );
    await writeFile(file + '.partial', Buffer.from(data, 'base64'));
    await rename(file + '.partial', file);
  }

  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (server.exitCode !== null) break;
      try {
        ready = (await fetch(base, { signal: AbortSignal.timeout(1000) })).ok;
      } catch {
        // Vite has not opened the loopback socket yet.
      }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error('Vite failed to start for ' + rev + '\n' + startup);
    await run({ page, open, shot });
  } finally {
    try {
      if (browser.isConnected()) await context.close();
    } finally {
      server.kill('SIGTERM');
      if (server.exitCode === null && server.signalCode === null) {
        await new Promise((resolve) => server.once('exit', resolve));
      }
    }
  }
}

async function motion(name, frames, at) {
  const dir = path.join(out, name);
  await mkdir(dir, { recursive: true });
  const began = Date.now();
  let written = 0;
  for (let i = 0; i < frames; i++) {
    if (sample && !sample.includes(i)) continue;
    const file = path.join(dir, String(i).padStart(3, '0') + '.png');
    if ((await stat(file).catch(() => null))?.size > 0) continue;
    await at(file, i, i / fps);
    written++;
    if (written === 1 || written % 15 === 0) {
      console.log(
        name +
          ' frame ' +
          i +
          '/' +
          frames +
          ' (' +
          ((Date.now() - began) / 1000).toFixed(1) +
          's)',
      );
    }
  }
}

const eased = (value) => value * value * (3 - 2 * value);
const phase = (time, from, duration) => eased(Math.max(0, Math.min(1, (time - from) / duration)));
const eye = { x: 12.1, y: -2.6, z: -7.6, yaw: 1.23, pitch: -0.13 };
const kitchenPose = (time) => {
  const share = phase(time, 0, 11);
  return {
    position: [eye.x + 0.15 * share, -1, eye.z - 0.18 * share],
    yaw: eye.yaw - 0.9 * share,
    pitch: eye.pitch - 0.11 * share,
    fov: 69,
  };
};
const gardenPose = (time) => {
  const share = phase(time, 0, 6.25);
  const azimuth = 0.6 + 1.05 * share;
  const elevation = ((69 - 55 * share) * Math.PI) / 180;
  const target = [5.5, -1, -3.4];
  const radius = 49;
  const run = radius * Math.cos(elevation);
  return {
    target,
    position: [
      target[0] + run * Math.sin(azimuth),
      target[1] + radius * Math.sin(elevation),
      target[2] + run * Math.cos(azimuth),
    ],
    fov: 39,
  };
};
const walkStart = { x: 8.5, y: -2.6, z: -6.61, yaw: -Math.PI / 2, pitch: -0.07 };
const walkPose = (time) => {
  const corridor = phase(time, 0, 2.6);
  const turn = phase(time, 1.8, 1.6);
  const kitchen = phase(time, 2.15, 2.7);
  return {
    position: [8.5 + 2.55 * corridor, -1, -6.61 - 1.3 * kitchen],
    yaw: (-Math.PI / 2) * (1 - turn) + 0.15 * turn,
    pitch: -0.07 - 0.07 * kitchen,
    fov: 66,
  };
};

const mesa = process.env.REEL_GL === 'mesa';
const browser = await chromium.launch({
  headless: !mesa,
  args: [
    ...(mesa
      ? [
          '--use-gl=angle',
          '--use-angle=gl',
          '--ignore-gpu-blocklist',
          '--enable-webgl',
          '--disable-gpu-sandbox',
        ]
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    '--disable-dev-shm-usage',
    '--disable-gpu-watchdog',
  ],
});

try {
  for (const [name, rev, model] of [
    ['mock', 'c5a5f25', 'mock-home.json'],
    ['house', 'bff323b', 'home.json'],
  ]) {
    if (!withShot(name)) continue;
    await withViewer(rev, model, async ({ open, shot }) => {
      await open();
      await shot(path.join(out, name + '.png'));
      console.log(name + ' still');
    });
  }

  const passes = [
    ['early', '1da8338', 'fast'],
    ['lighting', '287cc95', 'fast'],
    ['shadows', 'e49f812', 'beautiful'],
    ['materials', '6820266', 'beautiful'],
  ];
  let kitchenStart = 0;
  for (const [name, rev, tier] of passes) {
    const start = kitchenStart;
    const frames = shotFrames(name);
    kitchenStart += frames;
    if (!withShot(name)) continue;
    await withViewer(rev, 'home.json', async ({ open, shot }) => {
      await open('walk=first&reelMode=kitchen&quality=' + tier, eye);
      await motion(name, frames, (file, i, time) =>
        shot(file, { pose: kitchenPose((start + i) / fps), tier, time }),
      );
    });
  }

  if (withShot('garden')) {
    await withViewer('6820266', 'home.json', async ({ open, shot }) => {
      await open('view=cutaway&level=souterrain&quality=beautiful&reelMode=outdoor');
      await motion('garden', shotFrames('garden'), (file, _, time) =>
        shot(file, { pose: gardenPose(time), tier: 'beautiful', time }),
      );
    });
  }

  if (withShot('walk')) {
    await withViewer('6820266', 'home.json', async ({ open, shot }) => {
      await open('walk=first&quality=beautiful&reelMode=walk', walkStart);
      await motion('walk', shotFrames('walk'), (file, _, time) =>
        shot(file, { pose: walkPose(time), tier: 'beautiful', time }),
      );
    });
  }

  if (withShot('section')) {
    await withViewer('6820266', 'home.json', async ({ page, open, shot }) => {
      await open('view=section&look=east&at=1.5&quality=beautiful&panel=view&reelMode=outdoor');
      const slider = page.getByRole('slider', { name: 'Cut at' });
      const total = Number(await slider.getAttribute('max'));
      await motion('section', shotFrames('section'), async (file, frame, time) => {
        const distance =
          Math.round((total * (0.1 + (0.62 * frame) / (shotFrames('section') - 1))) / 0.05) * 0.05;
        await slider.evaluate((input, next) => {
          const range = input;
          const set = Object.getOwnPropertyDescriptor(
            globalThis.HTMLInputElement.prototype,
            'value',
          ).set;
          set.call(range, String(next));
          range.dispatchEvent(new Event('input', { bubbles: true }));
        }, distance);
        await page.waitForFunction(
          (next) =>
            Math.abs(Number(globalThis.document.documentElement.dataset.reelSectionAt) - next) <
            0.001,
          distance,
        );
        await shot(file, { tier: 'beautiful', time });
      });
    });
  }
} finally {
  await browser.close();
}
