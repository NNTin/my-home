import { z } from 'zod';

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
  | { type: 'number'; tier: 'design'; label: string; default: number; unit?: string }
  /** A share from 0 to 1 in steps of `step` (0.05: 5 %), such as how far a shutter is closed. */
  | { type: 'fraction'; tier: ParamTier; label: string; default: number; step: number }
  /** One of a fixed list of values (strings), each with a label for people. */
  | {
      type: 'choice';
      tier: ParamTier;
      label: string;
      default: string;
      options: { value: string; label: string }[];
      /**
       * A choice of finish (docs/design/realistic-render.md §5.7): every option's value is the id
       * of a finish of the library that may be used on a part. The piece module draws its parts
       * with the chosen one (`material.finish`).
       */
      finish?: true;
    };

export type ParamValues = Record<string, string | number>;
/** Stored or sent parameter values: numbers and strings (colours) by key. */
export const ParamValues = z.record(z.string(), z.union([z.string(), z.number()]));

/** Fractions are edited in steps of 5 %. */
export const FRACTION_STEP = 0.05;

/** Every length is edited in steps of 1 mm (one decimal in centimetres). */
export const LENGTH_STEP = 0.001;
