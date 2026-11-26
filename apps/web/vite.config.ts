/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/** Where the dev server answers with the file; a build names it by its hash under `assets/`. */
const DEV_PATH = '/@my-home/sakuga-progress.js';

/**
 * The loading bar comes first (#166, packages/sakuga-vfx/AGENTS.md § The app's HUD): Sakuga VFX's
 * `progress.js` is a plain script, loaded by a classic `<script>` in `<head>` ahead of the module
 * entry, so `<sakuga-progress>` in index.html is drawn from the first paint while the main chunk is
 * still on its way. Upstream's rule: load it with a script tag, never split, rewrite or bundle it.
 * The build copies the file as it is into `assets/sakuga-progress-<hash>.js` (cached for good, like
 * every hashed asset); the dev server serves it from the package.
 */
function sakugaProgress(): Plugin {
  const file = createRequire(import.meta.url).resolve('@my-home/sakuga-vfx/progress.js');
  let base = '/';
  let build = false;
  let fileName = '';
  return {
    name: 'my-home:sakuga-progress',
    configResolved(config) {
      base = config.base;
      build = config.command === 'build';
    },
    configureServer(server) {
      server.middlewares.use(DEV_PATH, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(readFileSync(file));
      });
    },
    buildStart() {
      if (!build) return;
      const hash = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 8);
      fileName = `assets/sakuga-progress-${hash}.js`;
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName, source: readFileSync(file) });
    },
    transformIndexHtml: {
      // After Vite's own pass: a classic script is not for the bundler.
      order: 'post',
      // Before <title>: after the charset and viewport (the first layout is the phone's), and ahead
      // of the module entry and its CSS (a blocking script would wait for a stylesheet above it).
      handler: (html) => {
        if (!html.includes('<title>')) throw new Error('index.html has no <title>');
        const src = build ? `${base}${fileName}` : DEV_PATH;
        return html.replace('<title>', `<script src="${src}"></script>\n    <title>`);
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, '../..', ''), ...process.env };
  return {
    plugins: [react(), sakugaProgress()],
    resolve: {
      // n8ao names this package for a pass we do not use; it is not installed (D10 of the design).
      alias: {
        postprocessing: fileURLToPath(
          new URL('./src/beautiful/postprocessing-stub.ts', import.meta.url),
        ),
      },
    },
    build: {
      // three.js + drei make up most of the main chunk; the path tracer is a lazy one.
      chunkSizeWarningLimit: 1700,
      // A texture is a file a device fetches when a finish is first drawn, in one size
      // (docs/design/realistic-render.md §5.3): never inlined into the script, however small.
      assetsInlineLimit: (file) => (file.endsWith('.webp') ? false : undefined),
      // Everything the entry reaches statically is one chunk (D95 of the design). Left to itself
      // the bundler cuts shared modules by which lazy chunks import them: a lazy chunk that
      // imports one more module of the viewer splits the main chunk again, and the pieces
      // compress worse (1.4 kB in #116; 0.4 kB for render mode, which shares three.js' core).
      rolldownOptions: {
        output: { codeSplitting: { groups: [{ name: 'main', tags: ['$initial'] }] } },
      },
    },
    server: {
      port: 5173,
      proxy: { '/api': { target: env.API_URL ?? 'http://localhost:3000', changeOrigin: true } },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
      maxWorkers: 2,
    },
  };
});
