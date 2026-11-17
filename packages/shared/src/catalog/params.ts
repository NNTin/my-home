/**
 * Parameters of a catalogue type. A `basic` parameter may be changed per use, within its limits;
 * a `design` parameter is fixed by the type (changing it is a design change in git).
 */
export type ParamTier = 'basic' | 'design';

export type ParamSpec =
  | { type: 'color'; tier: ParamTier; label: string; default: string }
  /** Metres; `step` is the smallest change (0.001 m, one decimal in centimetres). */
  | {
      type: 'length';
      tier: ParamTier;
      label: string;
      default: number;
      min: number;
      max: number;
      step: number;
    }
  | {
      type: 'count';
      tier: ParamTier;
      label: string;
      default: number;
      min: number;
      max: number;
      /** Each counted part (a sash, a leaf) needs at least `minWidth` metres of the hole's width. */
      each?: { minWidth: number; one: string; other: string };
    }
  /** A unitless or non-length design value: opacity, metalness, roughness. */
  | { type: 'number'; tier: 'design'; label: string; default: number; unit?: string };

export type ParamValues = Record<string, string | number>;

/** Every length is edited in steps of 1 mm (one decimal in centimetres). */
export const LENGTH_STEP = 0.001;
