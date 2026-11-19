import { appliances } from './definitions/appliances';
import { doors } from './definitions/doors';
import { fixtures } from './definitions/fixtures';
import { furniture } from './definitions/furniture';
import { gates } from './definitions/gates';
import { kitchen } from './definitions/kitchen';
import { windows } from './definitions/windows';
import { HexColor, TypeId } from './ids';
import type { ParamSpec } from './params';
import type { CatalogType } from './types';

export interface Catalog {
  types: readonly CatalogType[];
  get(id: string): CatalogType | undefined;
}

/** Why a parameter spec is invalid, or undefined. */
function specProblem(spec: ParamSpec): string | undefined {
  switch (spec.type) {
    case 'color':
      return HexColor.safeParse(spec.default).data === spec.default
        ? undefined
        : `default ${spec.default} is not a lower-case #rrggbb colour`;
    case 'number':
      return Number.isFinite(spec.default) ? undefined : 'default must be a finite number';
    case 'length':
    case 'count': {
      if (spec.type === 'count' && ![spec.min, spec.max, spec.default].every(Number.isInteger)) {
        return 'a count needs integer limits and default';
      }
      if (spec.min > spec.max) return `min ${spec.min} is above max ${spec.max}`;
      if (spec.default < spec.min || spec.default > spec.max) {
        return `default ${spec.default} is outside ${spec.min} to ${spec.max}`;
      }
      return undefined;
    }
    case 'fraction':
      if (!(spec.step > 0 && spec.step <= 1)) return `step ${spec.step} must be in (0, 1]`;
      return spec.default >= 0 && spec.default <= 1 ? undefined : 'default must be from 0 to 1';
    case 'choice': {
      const values = spec.options.map((o) => o.value);
      if (values.length < 2) return 'a choice needs at least two options';
      if (new Set(values).size !== values.length) return 'duplicate option values';
      return values.includes(spec.default) ? undefined : `default ${spec.default} is not an option`;
    }
  }
}

/**
 * Builds a catalogue from an explicit list of types (no `import.meta.glob`: the api is bundled by
 * esbuild). Throws on an invalid id, a duplicate id, `min > max` or a default outside its limits,
 * so a broken definition fails at import, in every test run.
 */
export function createCatalog(types: readonly CatalogType[]): Catalog {
  const byId = new Map<string, CatalogType>();
  for (const type of types) {
    const fail = (message: string): never => {
      throw new Error(`Invalid catalogue type "${type.id}": ${message}`);
    };
    if (!TypeId.safeParse(type.id).success) fail('the id must look like "family.name"');
    if (byId.has(type.id)) fail('duplicate id');
    const placed = type.kind === 'furniture' || type.kind === 'fixtures';
    if (placed !== (type.placement === 'floor'))
      fail('furniture and fixtures, and only they, go in a room');
    if (!placed && (type.mounting !== undefined || type.elevation !== undefined)) {
      fail('only furniture and fixtures have a mounting or an elevation');
    }
    if (type.elevation !== undefined) {
      if (!(type.elevation >= 0)) fail(`elevation ${type.elevation} must not be negative`);
      if (type.mounting === 'ceiling') fail('a ceiling piece has no elevation');
    }
    for (const [key, spec] of Object.entries(type.params)) {
      const problem = specProblem(spec);
      if (problem) fail(`parameter "${key}": ${problem}`);
    }
    byId.set(type.id, type);
  }
  return { types: [...byId.values()], get: (id) => byId.get(id) };
}

/** Every piece type, in catalogue order (windows, doors, gates, furniture, kitchen, fixtures). */
export const catalog = createCatalog([
  ...windows,
  ...doors,
  ...gates,
  ...furniture,
  ...kitchen,
  ...appliances,
  ...fixtures,
]);
