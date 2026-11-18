import {
  basicOverridesSchema,
  formatCm,
  parseCm,
  type CatalogType,
  type ParamSpec,
  type ParamValues,
} from '@my-home/shared';

/**
 * The parameter playground's pure parts: what a typed colour or length means, and the `?p=` query
 * that shares a playground state. Nothing here is ever saved.
 */

/** `#rgb` or `#rrggbb` in any case, as lower-case `#rrggbb`; anything else gives undefined. */
export function normalizeHex(text: string): string | undefined {
  const match = /^\s*#([0-9a-f]{3}|[0-9a-f]{6})\s*$/i.exec(text);
  if (!match) return undefined;
  const hex = match[1]!.toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex}`;
}

type LengthSpec = Extract<ParamSpec, { type: 'length' }>;

/** Centimetres with one decimal, without the unit: the text of a length field. */
export const cmText = (metres: number) => (metres * 100).toFixed(1);

/** "80.0–220.0 cm" */
export const rangeText = (spec: { min: number; max: number }) =>
  `${cmText(spec.min)}–${cmText(spec.max)} cm`;

/** A typed length in cm: the value in metres when it is one within the limits, else why not. */
export function lengthInput(spec: LengthSpec, text: string): { value: number } | { error: string } {
  const value = parseCm(text);
  if (value === undefined) return { error: 'Type a length in cm, e.g. 92.5' };
  if (value < spec.min - 1e-9) return { error: `At least ${formatCm(spec.min)}` };
  if (value > spec.max + 1e-9) return { error: `At most ${formatCm(spec.max)}` };
  return { value };
}

const toBase64Url = (text: string) =>
  btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromBase64Url = (text: string) => atob(text.replace(/-/g, '+').replace(/_/g, '/'));

/** `?p=`: the overrides as base64url JSON; empty when there are none. */
export function encodeOverrides(overrides: ParamValues): string {
  return Object.keys(overrides).length === 0 ? '' : toBase64Url(JSON.stringify(overrides));
}

/**
 * The overrides in a `?p=` value, if it is valid against the type's basic overrides (only basic
 * keys, within their limits); otherwise none: a broken or stale link shows the defaults.
 */
export function decodeOverrides(type: CatalogType, text: string | null): ParamValues {
  if (!text) return {};
  try {
    const parsed = basicOverridesSchema(type).safeParse(JSON.parse(fromBase64Url(text)));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** The overrides with `key` set, or left out when `value` is the default. */
export function withOverride(
  type: CatalogType,
  overrides: ParamValues,
  key: string,
  value: string | number,
): ParamValues {
  const rest = Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== key));
  return type.params[key]?.default === value ? rest : { ...rest, [key]: value };
}
