import { fileURLToPath } from 'node:url';

// Resolved relative to this module: `src/` in dev and tests, `dist/` once bundled.
export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Hand-written migrations of the `media` schema (photos), applied by `migrateMedia`. */
export const mediaMigrationsFolder = fileURLToPath(new URL('../media-migrations', import.meta.url));

/** Hand-written migrations of the `userdata` schema, applied by `migrateUserdata`. */
export const userdataMigrationsFolder = fileURLToPath(
  new URL('../userdata-migrations', import.meta.url),
);

/** `data/homes/` at the repository root (copied into the api image). */
export const homesFolder = fileURLToPath(new URL('../../../data/homes', import.meta.url));

const homeFile = (name: string) =>
  fileURLToPath(new URL(`../../../data/homes/${name}`, import.meta.url));

/** The home: `data/homes/home.json` at the repository root (copied into the image). */
export const defaultHomeFile = homeFile('home.json');

/** Homes seeded when no SEED_FILE is set, in order (the viewer shows the oldest home first). */
export const defaultSeedFiles = [defaultHomeFile];
