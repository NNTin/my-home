import { execFileSync, spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { chromium } from 'playwright';

const [tempDir, referenceFile, ...only] = process.argv.slice(2);
if (!tempDir || !referenceFile) {
  throw new Error(
    'Usage: npm run capture -- <temporary directory> <photo metadata JSON> [shot...]',
  );
}

const repo = fileURLToPath(new URL('../../', import.meta.url));
const temp = await realpath(tempDir);
if (temp === path.resolve(repo) || temp.startsWith(repo)) {
  throw new Error('Keep reel media outside the repository.');
}
const out = path.join(temp, 'assets');
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const photo = await readJson(referenceFile);
const reference = referenceFile.replace(/\.json$/, '.webp');
const date = '2026-01-01T00:00:00.000Z';
const port = 43153;
const base = 'http://127.0.0.1:' + port;
const width = Number(process.env.REEL_CAPTURE_WIDTH ?? 960);
const height = width * (3 / 4);
const fps = Number(process.env.REEL_CAPTURE_FPS ?? 6);
if (!Number.isInteger(fps) || fps < 4 || fps > 30)
  throw new Error('Use a capture rate from 4 to 30 fps.');
const withShot = (name) => only.length === 0 || only.includes(name);

await mkdir(out, { recursive: true, mode: 0o700 });
if (withShot('match')) await copyFile(reference, path.join(out, 'reference.webp'));

const hook = [
  "import { useFrame as useReelFrame, useThree as useReelThree } from '@react-three/fiber';",
  "import { useEffect as useReelEffect } from 'react';",
  "import type { PerspectiveCamera as ReelPerspectiveCamera } from 'three';",
  '',
  'type ReelPose = { x: number; y: number; z: number; yaw: number; pitch: number; fov: number };',
  'let reelPose: ReelPose | null = null;',
  'function ReelCamera() {',
  '  const invalidate = useReelThree((state) => state.invalidate);',
  '  useReelEffect(() => {',
  '    Object.assign(window, { __reelSetPose: (pose: ReelPose | null) => {',
  '      reelPose = pose;',
  '      invalidate();',
  '    } });',
  '  }, [invalidate]);',
  '  useReelFrame(({ camera }) => {',
  '    if (!reelPose) return;',
  '    const { x, y, z, yaw, pitch, fov } = reelPose;',
  '    const view = camera as ReelPerspectiveCamera;',
  '    view.position.set(x, y, z);',
  "    view.rotation.set(pitch, yaw, 0, 'YXZ');",
  '    if (view.fov !== fov) {',
  '      view.fov = fov;',
  '      view.updateProjectionMatrix();',
  '    }',
  '  });',
  '  return null;',
  '}',
  '',
].join('\n');

function shell(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'inherit' });
}

async function checkout(rev) {
  const dir = path.join(temp, 'revisions', rev);
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
  const anchor = source.includes('<FrameView frame={frame} />')
    ? '<FrameView frame={frame} />'
    : '</Canvas>';
  await writeFile(scene, hook + source.replace(anchor, '<ReelCamera />\n          ' + anchor));
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
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(rev + ' page error: ' + error.message));
  const cdp = await context.newCDPSession(page);
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
      await page.waitForFunction(() => typeof globalThis.__reelSetPose === 'function', {
        timeout: 25_000,
      });
    } catch (error) {
      console.log((await page.locator('body').innerText()).slice(0, 700));
      throw error;
    }
    if (rev === 'e49f812' || rev === '6820266') {
      const tier = query.includes('beautiful') ? 'beautiful' : 'fast';
      try {
        await page.locator('canvas[data-tier="' + tier + '"]').waitFor({
          state: 'attached',
          timeout: 80_000,
        });
        await page.waitForLoadState('networkidle');
        await draw();
      } catch (error) {
        console.log('Viewer frame state', await canvas.evaluate((node) => ({ ...node.dataset })));
        throw error;
      }
    }
  }

  async function hideUi() {
    await page.addStyleTag({
      content: '* { visibility: hidden !important; } canvas { visibility: visible !important; }',
    });
  }

  async function draw() {
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
        ),
    );
  }

  async function pose(value) {
    await page.evaluate((next) => globalThis.__reelSetPose(next), value);
    await draw();
  }

  async function shot(file) {
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Viewer canvas is missing.');
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 93,
      clip: { ...box, scale: 1 },
    });
    await writeFile(file, Buffer.from(data, 'base64'));
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
    await run({ page, open, hideUi, draw, pose, shot });
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

async function motion(name, seconds, step, shot) {
  const dir = path.join(temp, 'frames', name + '-' + width + '-' + fps);
  await mkdir(dir, { recursive: true });
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) {
    const file = path.join(dir, String(i).padStart(3, '0') + '.jpg');
    if ((await stat(file).catch(() => null))?.size > 0) continue;
    await step(i, i / fps, i / (frames - 1));
    await shot(file);
    if (i % fps === 0) console.log(name + ' ' + i + '/' + frames);
  }
  shell(
    ffmpeg.path,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-framerate',
      String(fps),
      '-i',
      path.join(dir, '%03d.jpg'),
      '-vf',
      name === 'section'
        ? 'pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=30'
        : 'pad=ceil(iw/2)*2:ceil(ih/2)*2,tpad=stop_mode=clone:stop_duration=0.5,minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc',
      '-frames:v',
      String(seconds * 30),
      '-c:v',
      'libx264',
      '-crf',
      '16',
      '-pix_fmt',
      'yuv420p',
      '-threads',
      '2',
      '-movflags',
      '+faststart',
      path.join(out, name + '.mp4'),
    ],
    repo,
  );
}

const position = photo.pose.position;
const match = {
  ...position,
  yaw: photo.pose.yaw,
  pitch: photo.pose.pitch,
  fov: (2 * Math.atan(Math.tan(photo.pose.fovH / 2) / (width / height)) * 180) / Math.PI,
};
const figureAt = (pose) => ({ ...pose, y: pose.y - 1.6 });
const eased = (value) => value * value * (3 - 2 * value);
const rotation = (time) => {
  const share = eased(time / 13);
  return {
    x: match.x + 0.18 * share,
    y: match.y,
    z: match.z - 0.22 * share,
    yaw: match.yaw - 0.8 * share,
    pitch: match.pitch - 0.2 * share,
    fov: match.fov,
  };
};

async function floorPlan() {
  const doc = JSON.parse(
    execFileSync('git', ['show', '982af73:data/homes/home.json'], { cwd: repo, encoding: 'utf8' }),
  );
  const rooms = doc.rooms.filter((room) => room.levelId === 'souterrain');
  const kitchen = rooms.find((room) => room.id === 'souterrain-kitchen');
  const val = (point) => [point.x.value, point.z.value];
  const xs = rooms.flatMap((room) => room.outline.map((point) => point.x.value));
  const zs = rooms.flatMap((room) => room.outline.map((point) => point.z.value));
  const minX = Math.min(...xs) - 0.7;
  const minZ = Math.min(...zs) - 0.7;
  const planWidth = Math.max(...xs) - minX + 0.7;
  const planHeight = Math.max(...zs) - minZ + 0.7;
  const walls = doc.walls.filter((wall) => wall.levelId === 'souterrain');
  const lines = walls
    .flatMap((wall) => {
      const [x, z] = val(wall.start);
      const [x2, z2] = val(wall.end);
      const length = Math.hypot(x2 - x, z2 - z);
      const edge = (a, b) =>
        a < b
          ? '<path d="M ' +
            (x + ((x2 - x) * a) / length) +
            ' ' +
            (z + ((z2 - z) * a) / length) +
            ' L ' +
            (x + ((x2 - x) * b) / length) +
            ' ' +
            (z + ((z2 - z) * b) / length) +
            '"/>'
          : '';
      const cuts = doc.openings
        .filter((opening) => opening.wallId === wall.id)
        .sort((a, b) => a.offset.value - b.offset.value);
      let start = 0;
      const paths = [];
      for (const opening of cuts) {
        paths.push(edge(start, opening.offset.value));
        start = opening.offset.value + opening.width.value;
      }
      paths.push(edge(start, length));
      return paths;
    })
    .join('');
  const shapes = rooms
    .map(
      (room) =>
        '<polygon fill="' +
        (room === kitchen ? '#e2e9ad' : '#2b3630') +
        '" points="' +
        room.outline.map((point) => val(point).join(',')).join(' ') +
        '"/>',
    )
    .join('');
  const center = kitchen.outline.reduce(
    (a, p) => [
      a[0] + p.x.value / kitchen.outline.length,
      a[1] + p.z.value / kitchen.outline.length,
    ],
    [0, 0],
  );
  const scale = Math.min(860 / planWidth, 640 / planHeight);
  const left = (960 - planWidth * scale) / 2 - minX * scale;
  const top = (720 - planHeight * scale) / 2 - minZ * scale;
  const transform = 'translate(' + left + ' ' + top + ') scale(' + scale + ')';
  const labelX = left + center[0] * scale;
  const labelY = top + center[1] * scale + 7;
  await writeFile(
    path.join(out, 'plan.svg'),
    [
      '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720">',
      '<rect width="960" height="720" fill="#202b25"/>',
      '<g transform="' + transform + '">',
      shapes,
      '<g fill="none" stroke="#adb8ac" stroke-width="0.085">' + lines + '</g>',
      '</g>',
      '<text x="' +
        labelX +
        '" y="' +
        labelY +
        '" font-family="DejaVu Sans, sans-serif" font-weight="700" font-size="24" text-anchor="middle" fill="#17211b">Kitchen</text>',
      '</svg>',
    ].join(''),
  );
}

if (withShot('plan')) await floorPlan();
if (only.length === 1 && only[0] === 'plan') process.exit(0);

const browser = await chromium.launch({
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-dev-shm-usage',
    '--disable-gpu-watchdog',
    '--disable-gpu-watchdog',
  ],
});

try {
  for (const [name, rev, model] of [
    ['mock', 'c5a5f25', 'mock-home.json'],
    ['house', 'bff323b', 'home.json'],
  ]) {
    if (!withShot(name)) continue;
    console.log(name + ' ' + rev);
    await withViewer(rev, model, async ({ open, hideUi, draw, shot }) => {
      await open();
      await hideUi();
      await draw();
      await shot(path.join(out, name + '.jpg'));
    });
  }

  const passes = [
    ['early', '1da8338', 0, 3, 'fast'],
    ['lighting', '287cc95', 3, 3, 'fast'],
    ['shadows', 'e49f812', 6, 3, 'beautiful'],
    ['materials', '6820266', 9, 4, 'beautiful'],
  ];
  for (const [name, rev, start, duration, quality] of passes) {
    if (!withShot(name)) continue;
    console.log(name + ' ' + rev);
    await withViewer(rev, 'home.json', async ({ open, hideUi, pose, shot }) => {
      await open('walk=first&quality=' + quality, figureAt(match));
      await hideUi();
      await motion(name, duration, (_, time) => pose(rotation(start + time)), shot);
    });
  }

  if (withShot('match')) {
    await withViewer('1da8338', 'home.json', async ({ open, hideUi, pose, shot }) => {
      await open('walk=first&quality=fast', figureAt(match));
      await hideUi();
      await pose(match);
      await shot(path.join(out, 'match.jpg'));
    });
  }

  if (['walk', 'section'].some(withShot)) {
    await withViewer('6820266', 'home.json', async ({ page, open, hideUi, pose, draw, shot }) => {
      if (withShot('section')) {
        await open('view=section&look=east&at=1.5&quality=fast&panel=view');
        const slider = page.getByRole('slider', { name: 'Cut at' });
        const handle = await slider.elementHandle();
        await hideUi();
        await motion(
          'section',
          2,
          async (_, __, share) => {
            await handle.evaluate(
              (input, fraction) => {
                const set = Object.getOwnPropertyDescriptor(
                  globalThis.HTMLInputElement.prototype,
                  'value',
                ).set;
                set.call(input, String(Number(input.max) * fraction));
                input.dispatchEvent(new Event('input', { bubbles: true }));
              },
              0.12 + 0.45 * eased(share),
            );
            await draw();
          },
          shot,
        );
      }

      if (withShot('walk')) {
        await open('walk=first&quality=fast', {
          x: 8.5,
          y: -2.6,
          z: -6.61,
          yaw: -Math.PI / 2,
          pitch: -0.07,
        });
        await hideUi();
        const phase = (time, from, duration) =>
          eased(Math.max(0, Math.min(1, (time - from) / duration)));
        await motion(
          'walk',
          4,
          (_, time) => {
            const corridor = phase(time, 0, 2.35);
            const turn = phase(time, 1.4, 1.35);
            const kitchen = phase(time, 1.85, 1.9);
            return pose({
              x: 8.5 + 2.55 * corridor,
              y: -1,
              z: -6.61 - 1.3 * kitchen,
              yaw: (-Math.PI / 2) * (1 - turn) + 0.15 * turn,
              pitch: -0.04 - 0.07 * kitchen,
              fov: 64,
            });
          },
          shot,
        );
      }
    });
  }
} finally {
  await browser.close();
}
