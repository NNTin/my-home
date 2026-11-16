import { fileURLToPath } from 'node:url';

// Resolved relative to this module: `src/` in dev and tests, `dist/` once bundled.
export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/** The home seeded by default: `data/homes/` at the repository root (copied into the image). */
export const defaultHomeFile = fileURLToPath(
  new URL('../../../data/homes/mock-home.json', import.meta.url),
);
