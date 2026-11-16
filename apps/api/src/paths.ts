import { fileURLToPath } from 'node:url';

// Resolved relative to this module: `src/` in dev and tests, `dist/` once bundled.
export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Hand-written migrations of the `media` schema (photos), applied by `migrateMedia`. */
export const mediaMigrationsFolder = fileURLToPath(new URL('../media-migrations', import.meta.url));

const homeFile = (name: string) =>
  fileURLToPath(new URL(`../../../data/homes/${name}`, import.meta.url));

/** The mock home: `data/homes/` at the repository root (copied into the image). */
export const defaultHomeFile = homeFile('mock-home.json');

/**
 * Homes seeded when no SEED_FILE is set, in order: the real home first, so the viewer (which shows
 * the oldest home) opens it, then the mock home.
 */
export const defaultSeedFiles = [homeFile('home.json'), defaultHomeFile];
