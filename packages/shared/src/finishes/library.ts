import { HexColor } from './color';
import { exterior } from './definitions/exterior';
import { floors } from './definitions/floors';
import { ground } from './definitions/ground';
import { parts } from './definitions/parts';
import { walls } from './definitions/walls';
import { FINISH_SURFACES, FinishId, TEXTURE_MAPS, type Finish } from './types';

export interface FinishLibrary {
  finishes: readonly Finish[];
  get(id: string): Finish | undefined;
}

const unit = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
const unique = (list: readonly unknown[]) => new Set(list).size === list.length;

/**
 * Builds a finish library from an explicit list (no `import.meta.glob`: the api is bundled by
 * esbuild). Throws on an invalid or duplicate id, a tint that is not `#rrggbb`, a texture without
 * a tile size and a plain finish with one, so a broken definition fails at import, in every test
 * run. A finish's description and its texture's source are checked by `listing.ts`.
 */
export function createFinishLibrary(finishes: readonly Finish[]): FinishLibrary {
  const byId = new Map<string, Finish>();
  const sets = new Set<string>();
  for (const finish of finishes) {
    const fail = (message: string): never => {
      throw new Error(`Invalid finish "${finish.id}": ${message}`);
    };
    if (!FinishId.safeParse(finish.id).success) fail('the id must look like "material.name"');
    if (byId.has(finish.id)) fail('duplicate id');
    if (finish.name.trim() === '') fail('a finish needs a name');
    if (!unique(finish.surfaces) || finish.surfaces.some((s) => !FINISH_SURFACES.includes(s)))
      fail('surfaces must be distinct kinds of surface');
    if (HexColor.safeParse(finish.tint).data !== finish.tint)
      fail(`tint ${finish.tint} is not a lower-case #rrggbb colour`);
    if (!unit(finish.roughness) || !unit(finish.metalness))
      fail('roughness and metalness are numbers from 0 to 1');
    const { texture } = finish;
    if (!texture) {
      if (finish.tileSize !== undefined) fail('a plain finish has no tile size');
    } else {
      if (!/^[a-z][a-z0-9-]*$/.test(texture.id)) fail(`texture set id "${texture.id}" is invalid`);
      if (sets.has(texture.id)) fail(`texture set "${texture.id}" belongs to another finish`);
      sets.add(texture.id);
      if (!unique(texture.maps) || texture.maps.some((m) => !TEXTURE_MAPS.includes(m)))
        fail('texture maps must be distinct');
      if (!texture.maps.includes('normal')) fail('every texture set has a normal map');
      if (!(finish.tileSize !== undefined && finish.tileSize > 0))
        fail('a textured finish needs a tile size in metres');
    }
    byId.set(finish.id, finish);
  }
  return { finishes: [...byId.values()], get: (id) => byId.get(id) };
}

/** Every finish, in library order: floors, walls and ceilings, exterior, ground, parts. */
export const finishes = createFinishLibrary([
  ...floors,
  ...walls,
  ...exterior,
  ...ground,
  ...parts,
]);

/**
 * Why a part of a catalogue piece may not name this finish, or undefined: the library must have
 * it, for the surface `part` (docs/design/realistic-render.md §5.7).
 */
export function partFinishProblem(
  id: string,
  library: FinishLibrary = finishes,
): string | undefined {
  const finish = library.get(id);
  if (!finish) return `"${id}" is not a finish of the library`;
  if (!finish.surfaces.includes('part')) return `the finish "${id}" is not for parts`;
  return undefined;
}
