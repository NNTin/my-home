import { LENGTH_STEP, type ParamSpec, type ParamTier } from '../params';

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
