import { z } from 'zod';
import { HexColor } from './ids';
import type { ParamSpec, ParamValues } from './params';
import type { CatalogType } from './types';

/** The zod schema for one value of a parameter, with its limits. */
function valueSchema(spec: ParamSpec): z.ZodType<string | number> {
  switch (spec.type) {
    case 'color':
      return HexColor;
    case 'length':
      return z.number().min(spec.min).max(spec.max);
    case 'count':
      return z.number().int().min(spec.min).max(spec.max);
    case 'number':
      return z.number();
  }
}

const basicEntries = (type: CatalogType) =>
  Object.entries(type.params).filter(([, spec]) => spec.tier === 'basic');

/** Every parameter at its default. */
export function defaultParams(type: CatalogType): ParamValues {
  return Object.fromEntries(Object.entries(type.params).map(([key, spec]) => [key, spec.default]));
}

/**
 * What a use may change: only basic parameters, each optional and within its limits; colours
 * are lower-cased. Unknown and design keys are rejected (a strict object), with path-based issues.
 */
export function basicOverridesSchema(type: CatalogType): z.ZodType<ParamValues> {
  const shape = Object.fromEntries(
    basicEntries(type).map(([key, spec]) => [key, valueSchema(spec).optional()]),
  );
  return z.strictObject(shape) as unknown as z.ZodType<ParamValues>;
}

/**
 * The values a use is drawn with: the defaults, with every valid override applied. Unknown,
 * design-only or invalid keys are listed in `ignored` instead of throwing, so stale stored data
 * never breaks a render.
 */
export function effectiveParams(
  type: CatalogType,
  overrides?: unknown,
): { values: ParamValues; ignored: string[] } {
  const values = defaultParams(type);
  const ignored: string[] = [];
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return { values, ignored };
  }
  for (const [key, value] of Object.entries(overrides)) {
    const spec = Object.hasOwn(type.params, key) ? type.params[key] : undefined;
    const parsed = spec?.tier === 'basic' ? valueSchema(spec).safeParse(value) : undefined;
    if (parsed?.success) values[key] = parsed.data;
    else ignored.push(key);
  }
  return { values, ignored };
}
