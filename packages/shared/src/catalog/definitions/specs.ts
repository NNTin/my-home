import { FRACTION_STEP, LENGTH_STEP, type ParamSpec, type ParamTier } from '../params';

/** Shorthands for the definitions; not exported from the package. */

export const color = (label: string, value: string, tier: ParamTier = 'basic'): ParamSpec => ({
  type: 'color',
  tier,
  label,
  default: value,
});

/** A basic length with limits. */
export const length = (label: string, value: number, min: number, max: number): ParamSpec => ({
  type: 'length',
  tier: 'basic',
  label,
  default: value,
  min,
  max,
  step: LENGTH_STEP,
});

/** A design length: fixed by the type, so its only allowed value is the default. */
export const fixedLength = (label: string, value: number): ParamSpec => ({
  type: 'length',
  tier: 'design',
  label,
  default: value,
  min: value,
  max: value,
  step: LENGTH_STEP,
});

export const count = (
  label: string,
  value: number,
  min: number,
  max: number,
  each?: { minWidth: number; one: string; other: string },
): ParamSpec => ({
  type: 'count',
  tier: 'basic',
  label,
  default: value,
  min,
  max,
  ...(each && { each }),
});

export const number = (label: string, value: number, unit?: string): ParamSpec => ({
  type: 'number',
  tier: 'design',
  label,
  default: value,
  ...(unit && { unit }),
});

/** A basic share from 0 to 1 (shown in %), such as how far a shutter or curtain is closed. */
export const fraction = (label: string, value: number): ParamSpec => ({
  type: 'fraction',
  tier: 'basic',
  label,
  default: value,
  step: FRACTION_STEP,
});

/** A basic choice of one of `options` (value → label), the first entry's value as the default. */
export const choice = (
  label: string,
  options: Record<string, string>,
  value = Object.keys(options)[0]!,
): ParamSpec => ({
  type: 'choice',
  tier: 'basic',
  label,
  default: value,
  options: Object.entries(options).map(([v, l]) => ({ value: v, label: l })),
});
