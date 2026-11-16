import { Id } from '@my-home/shared';
import type { Vec2 } from '../builder/buildHome';
import { rectangle } from '../editor/geometry';
import type { ItemTypeModule } from './types';

export interface CatalogCategory {
  name: string;
  types: ItemTypeModule[];
}

export interface ItemTypeRegistry {
  /** All types, sorted by category then name. */
  types: ItemTypeModule[];
  categories: CatalogCategory[];
  get(id: string): ItemTypeModule | undefined;
  /** The type's local footprint (explicit, or its default-size rectangle). */
  footprint(type: ItemTypeModule): Vec2[];
}

/** `./bed/index.tsx` -> `bed` */
const folderOf = (path: string) => /(?:^|\/)([^/]+)\/index\.tsx?$/.exec(path)?.[1];

function check(path: string, value: unknown): ItemTypeModule {
  const fail = (message: string): never => {
    throw new Error(`Invalid item type module ${path}: ${message}`);
  };
  const m = (value as { default?: unknown } | undefined)?.default as
    Partial<ItemTypeModule> | undefined;
  if (!m || typeof m !== 'object') return fail('expected `export default defineItemType({...})`');
  if (typeof m.id !== 'string' || !Id.safeParse(m.id).success) fail('`id` must be a valid id');
  const folder = folderOf(path);
  if (folder !== m.id) fail(`\`id\` "${m.id}" must equal the folder name "${folder}"`);
  for (const key of ['name', 'category', 'icon', 'color'] as const) {
    if (typeof m[key] !== 'string' || m[key] === '') fail(`\`${key}\` must be a non-empty string`);
  }
  const size = m.size;
  if (!size || ![size.width, size.depth, size.height].every((n) => Number.isFinite(n) && n > 0))
    fail('`size` needs positive `width`, `depth` and `height`');
  if (m.footprint !== undefined && m.footprint.length < 3)
    fail('`footprint` needs at least 3 points');
  if (!m.snapping || !['back', 'any', 'none'].includes(m.snapping.wall))
    fail('`snapping.wall` must be "back", "any" or "none"');
  if (typeof m.Render !== 'function' && typeof m.Render !== 'object')
    fail('`Render` must be a React component');
  return m as ItemTypeModule;
}

/**
 * Builds a registry from module files keyed by path, as returned by `import.meta.glob`.
 * Throws on an invalid module or a duplicate id, so a broken type fails the build and tests.
 */
export function createRegistry(files: Record<string, unknown>): ItemTypeRegistry {
  const byId = new Map<string, ItemTypeModule>();
  for (const [path, file] of Object.entries(files)) {
    const type = check(path, file);
    if (byId.has(type.id)) throw new Error(`Duplicate item type id "${type.id}" in ${path}`);
    byId.set(type.id, type);
  }
  const types = [...byId.values()].sort(
    (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );
  const categories: CatalogCategory[] = [];
  for (const type of types) {
    const last = categories.at(-1);
    if (last?.name === type.category) last.types.push(type);
    else categories.push({ name: type.category, types: [type] });
  }
  return {
    types,
    categories,
    get: (id) => byId.get(id),
    footprint: (type) => type.footprint ?? rectangle(type.size.width, type.size.depth),
  };
}

/** Every `src/items/<type>/index.tsx`, found at build time. */
export const registry = createRegistry(
  import.meta.glob(['./*/index.ts', './*/index.tsx'], { eager: true }),
);
