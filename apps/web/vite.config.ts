/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, '../..', ''), ...process.env };
  return {
    plugins: [react()],
    resolve: {
      // n8ao names this package for a pass we do not use; it is not installed (D10 of the design).
      alias: {
        postprocessing: fileURLToPath(
          new URL('./src/beautiful/postprocessing-stub.ts', import.meta.url),
        ),
      },
    },
    build: {
      // three.js + drei make up most of the bundle.
      chunkSizeWarningLimit: 1500,
      // A texture is a file a device fetches when a finish is first drawn, in one size
      // (docs/design/realistic-render.md §5.3): never inlined into the script, however small.
      assetsInlineLimit: (file) => (file.endsWith('.webp') ? false : undefined),
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
