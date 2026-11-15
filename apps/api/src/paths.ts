import { fileURLToPath } from 'node:url';

// Resolved relative to this module: `src/` in dev and tests, `dist/` once bundled.
export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
