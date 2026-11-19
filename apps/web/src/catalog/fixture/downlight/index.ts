import { colorParam, cylinder, dimension, numberParam, shade } from '../../parts';
import { definePiece } from '../../types';
import { sizeOf } from '../../furniture/size';

/** The lens' colour by light colour (the drawing does not light the room). */
const LIGHT = { warm: '#ffe4b5', neutral: '#fff8ec', daylight: '#eef5ff' } as const;

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
    const light = LIGHT[String(values.light) as keyof typeof LIGHT] ?? LIGHT.warm;
    return [
      cylinder([0, housing / 2, 0], D * 0.8, housing, shade(color, -0.55), 'body'),
      cylinder([0, -trim / 2, 0], D, trim, color, 'frame'),
      cylinder([0, -trim - 0.0005, 0], D * 0.72, 0.001, light, 'glass'),
    ];
  },
  dimensions: (values) => {
    const { width: D, height: housing } = sizeOf(values);
    const trim = numberParam(values, 'trim');
    return [
      dimension([-D / 2, -trim, D / 2], [D / 2, -trim, D / 2], D, 'Diameter'),
      dimension([D / 2, 0, 0], [D / 2, housing, 0], housing, 'Housing depth'),
    ];
  },
});
