import type { ParamValues } from '@my-home/shared';
import { colorParam, cylinder, dimension, numberParam, shade } from '../../parts';
import { definePiece } from '../../types';
import { sizeOf } from '../../furniture/size';

/** The lens' colour by light colour. */
const LIGHT = { warm: '#ffe4b5', neutral: '#fff8ec', daylight: '#eef5ff' } as const;
/** The colour of the light it throws: paler than the lens, which is seen against a white ceiling. */
const GLOW = { warm: '#fff0dc', neutral: '#fff9f1', daylight: '#f1f6ff' } as const;
const kindOf = (values: ParamValues) =>
  (String(values.light) in LIGHT ? String(values.light) : 'warm') as keyof typeof LIGHT;

/** About 400 lm spread over the half space below the ceiling. */
const CANDELA = 65;
/** How far one downlight lights a room, in metres. */
const RANGE = 6;
/**
 * Where its light comes from, below the ceiling's surface. A point light stands in for the cone
 * and for what the room throws back, so it hangs low enough to light the ceiling around it softly.
 */
const EMITTER_DROP = 0.25;

/**
 * A recessed downlight. Its frame starts at the ceiling's surface (y = 0), +y up into the ceiling:
 * the housing sits above it, hidden in the house; the trim ring and the lens are flush below it.
 */
export default definePiece({
  id: 'fixture.downlight',
  parts: (values) => {
    const { width: D, height: housing } = sizeOf(values);
    const trim = numberParam(values, 'trim');
    const color = colorParam(values, 'trimColor');
    const light = LIGHT[kindOf(values)];
    return [
      cylinder([0, housing / 2, 0], D * 0.8, housing, shade(color, -0.55), 'body'),
      cylinder([0, -trim / 2, 0], D, trim, color, 'frame'),
      cylinder([0, -trim - 0.0005, 0], D * 0.72, 0.001, light, 'glass'),
    ];
  },
  emits: (values) => [
    {
      position: [0, -EMITTER_DROP, 0],
      color: GLOW[kindOf(values)],
      intensity: CANDELA,
      range: RANGE,
    },
  ],
  dimensions: (values) => {
    const { width: D, height: housing } = sizeOf(values);
    const trim = numberParam(values, 'trim');
    return [
      dimension([-D / 2, -trim, D / 2], [D / 2, -trim, D / 2], D, 'Diameter'),
      dimension([D / 2, 0, 0], [D / 2, housing, 0], housing, 'Housing depth'),
    ];
  },
});
