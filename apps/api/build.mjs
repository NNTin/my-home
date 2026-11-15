import { build } from 'esbuild';

// Bundle our own code (including the workspace package @my-home/shared, which ships TS
// source) and keep every npm dependency external; they are installed in the runtime image.
const externalNpmPackages = {
  name: 'external-npm-packages',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) =>
      args.path.startsWith('@my-home/') ? undefined : { path: args.path, external: true },
    );
  },
};

await build({
  entryPoints: ['src/server.ts', 'src/migrate.ts', 'src/seed.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  plugins: [externalNpmPackages],
});
