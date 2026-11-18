import { fileURLToPath } from 'node:url';
import { defaultSeedFiles } from '../src/paths';

/**
 * A minimal fixture home (id `mock-home`) for the api tests. It is not under `data/homes`, so no
 * environment ever syncs it; the tests load it into a throwaway database.
 */
export const mockHomeFile = fileURLToPath(
  new URL('../../../packages/shared/test-fixtures/mock-home.json', import.meta.url),
);

/** What the tests seed: the home and the fixture, as every environment once did. */
export const testSeedFiles = [...defaultSeedFiles, mockHomeFile];
