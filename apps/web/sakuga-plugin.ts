import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * Sakuga VFX in the web build (packages/sakuga-vfx/AGENTS.md, docs/design/hud.md §7.1, §9).
 *
 * Two classic scripts, never modules and never in the main chunk:
 * - `sakuga-progress-<hash>.js`, blocking, before `<title>`: the loading bar, upstream's `progress.js` as it
 *   is, with the core inside. It sets `window.SakugaFX` from the first paint (#166).
 * - `sakuga-hud-<hash>.js`, deferred, right after it: every other element the app uses, each **without its core
 *   block** (the progress bar's core serves them all: "the core once", owner's answer 5 on #167), and the icons.
 *   Deferred scripts run in document order before the module entry, so every element is defined before React
 *   mounts. If it fails to load, the main chunk defines plain fallbacks (`src/hud/fallback.ts`).
 *
 * The package's files stay as upstream shapes them; only this build output leaves the core out. Both are cached
 * for good, like every hashed asset. The dev server serves them from the package.
 */

/** The elements in `sakuga-hud`, in the package's `NAMES` order. A family's PR adds its own (§12). */
export const HUD_ELEMENTS = ['button', 'slider', 'checkbox', 'input', 'tabs', 'toast'] as const;

const CORE_START = '// >>> sakuga core';
const CORE_END = '// <<< sakuga core';
/** What every component file ends with once its core block is gone: it uses the core already on the page. */
export const COMPONENT_END = 'component(window.SakugaFX);\n})();';

/** A component file without its copy of the core (the lines from `>>> sakuga core` to `<<< sakuga core`). */
export function stripCore(source: string, file: string): string {
  const start = source.indexOf(CORE_START);
  const end = source.indexOf(CORE_END);
  if (start < 0 || end < start) throw new Error(`${file}: no sakuga core markers`);
  const lineStart = source.lastIndexOf('\n', start) + 1;
  const lineEnd = source.indexOf('\n', end);
  const stripped = source.slice(0, lineStart) + source.slice(lineEnd + 1);
  if (stripped.includes('sakuga core') || !stripped.trimEnd().endsWith(COMPONENT_END))
    throw new Error(`${file}: does not end in ${COMPONENT_END} once its core is gone`);
  return stripped;
}

/** The package's folder. */
export function packageRoot(): string {
  return path.dirname(createRequire(import.meta.url).resolve('@my-home/sakuga-vfx/package.json'));
}

/** The text of `sakuga-hud`: the elements without their core, then the icons. */
export function hudSource(root = packageRoot(), names: readonly string[] = HUD_ELEMENTS): string {
  const parts = names.map((name) => {
    const file = path.join(root, name, `${name}.js`);
    return stripCore(readFileSync(file, 'utf8'), file);
  });
  parts.push(readFileSync(path.join(root, 'icons/icons.js'), 'utf8'));
  return (
    '// Sakuga VFX for my-home: the HUD elements without their core (the loading bar has set window.SakugaFX), and the icons.\n' +
    parts.join('\n')
  );
}

/**
 * Puts the two scripts into index.html: the progress bar blocking before `<title>` (after the charset and
 * viewport, ahead of the module entry and its CSS), and `sakuga-hud` deferred right after it.
 */
export function withSakugaScripts(html: string, progress: string, hud: string): string {
  if (!html.includes('<title>')) throw new Error('index.html has no <title>');
  return html.replace(
    '<title>',
    `<script src="${progress}"></script>\n    <script defer src="${hud}"></script>\n    <title>`,
  );
}

const DEV = { progress: '/@my-home/sakuga-progress.js', hud: '/@my-home/sakuga-hud.js' };
const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex').slice(0, 8);

export function sakuga(): Plugin {
  const root = packageRoot();
  const progressFile = path.join(root, 'progress/progress.js');
  let base = '/';
  let build = false;
  const names = { progress: '', hud: '' };
  return {
    name: 'my-home:sakuga',
    configResolved(config) {
      base = config.base;
      build = config.command === 'build';
    },
    configureServer(server) {
      const serve = (url: string, body: () => string | Buffer) =>
        server.middlewares.use(url, (_req, res) => {
          res.setHeader('Content-Type', 'text/javascript');
          res.end(body());
        });
      serve(DEV.progress, () => readFileSync(progressFile));
      serve(DEV.hud, () => hudSource(root));
    },
    buildStart() {
      if (!build) return;
      names.progress = `assets/sakuga-progress-${hash(readFileSync(progressFile))}.js`;
      names.hud = `assets/sakuga-hud-${hash(hudSource(root))}.js`;
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: names.progress,
        source: readFileSync(progressFile),
      });
      this.emitFile({ type: 'asset', fileName: names.hud, source: hudSource(root) });
    },
    transformIndexHtml: {
      // After Vite's own pass: classic scripts are not for the bundler.
      order: 'post',
      handler: (html) =>
        build
          ? withSakugaScripts(html, `${base}${names.progress}`, `${base}${names.hud}`)
          : withSakugaScripts(html, DEV.progress, DEV.hud),
    },
  };
}
