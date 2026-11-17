import { catalog, TypeId, type CatalogType } from '@my-home/shared';
import type { PieceModule } from './types';

export interface PieceRegistry {
  get(id: string): PieceModule | undefined;
  /** In the order of the shared catalogue. */
  all: PieceModule[];
}

/** `./window/casement/index.ts` -> `window.casement` */
const idOfPath = (path: string) => {
  const match = /(?:^|\/)([^/]+)\/([^/]+)\/index\.tsx?$/.exec(path);
  return match ? `${match[1]}.${match[2]}` : undefined;
};

function check(path: string, value: unknown): PieceModule {
  const fail = (message: string): never => {
    throw new Error(`Invalid piece module ${path}: ${message}`);
  };
  const m = (value as { default?: unknown } | undefined)?.default as
    Partial<PieceModule> | undefined;
  if (!m || typeof m !== 'object') return fail('expected `export default definePiece({...})`');
  if (typeof m.id !== 'string' || !TypeId.safeParse(m.id).success)
    fail('`id` must be a type id like "window.casement"');
  const expected = idOfPath(path);
  if (expected !== m.id) fail(`\`id\` "${m.id}" must match its folder ("${expected}")`);
  if (typeof m.parts !== 'function') fail('`parts` must be a function');
  if (typeof m.dimensions !== 'function') fail('`dimensions` must be a function');
  return m as PieceModule;
}

/**
 * Builds the registry from module files keyed by path, as returned by `import.meta.glob`, and
 * checks it against the shared catalogue: exactly one module per type. Throws on an invalid
 * module, a duplicate, a module without a type or a type without a module, so a broken piece
 * fails the build and the tests.
 */
export function createPieces(
  files: Record<string, unknown>,
  types: readonly CatalogType[] = catalog.types,
): PieceRegistry {
  const byId = new Map<string, PieceModule>();
  for (const [path, file] of Object.entries(files)) {
    const piece = check(path, file);
    if (byId.has(piece.id)) throw new Error(`Duplicate piece module "${piece.id}" in ${path}`);
    byId.set(piece.id, piece);
  }
  const known = new Set(types.map((t) => t.id));
  const extra = [...byId.keys()].filter((id) => !known.has(id));
  if (extra.length) throw new Error(`Piece modules without a catalogue type: ${extra.join(', ')}`);
  const missing = types.filter((t) => !byId.has(t.id)).map((t) => t.id);
  if (missing.length)
    throw new Error(`Catalogue types without a piece module: ${missing.join(', ')}`);
  return { get: (id) => byId.get(id), all: types.map((t) => byId.get(t.id)!) };
}

/** Every `src/catalog/<family>/<variant>/index.ts`, found at build time. */
export const pieces = createPieces(import.meta.glob('./*/*/index.ts', { eager: true }));
