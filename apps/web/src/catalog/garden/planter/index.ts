import type { Vec2 } from '../../../builder/buildHome';
import { box, colorParam, cylinder, dimension, lathe, numberParam, shade } from '../../parts';
import { definePiece } from '../../types';
import { sizeOf } from '../../furniture/size';

/** The thickness of a round pot's wall at its rim, and how far the soil lies below it. */
const WALL = 0.02;
const SOIL_DROP = 0.03;
/** A round pot's foot is this share of its diameter: it narrows towards the ground. */
const FOOT = 0.78;

/**
 * A round pot, turned from its profile: up the outside from the middle of its base, over the
 * rim and down the inside to where the soil lies. The corners of the base and the rim are sharp.
 */
function potProfile(radius: number, height: number): Vec2[] {
  const foot = radius * FOOT;
  const inner = radius - WALL;
  const soil = height - SOIL_DROP;
  return [
    [0, 0],
    [foot, 0],
    [foot, 0],
    [radius, height],
    [radius, height],
    [inner, height],
    [inner, height],
    [inner, soil],
    [0, soil],
  ];
}

/** A plant as one rounded bush: widest a third of the way up, closing to a blunt top. */
const bushProfile = (radius: number, height: number): Vec2[] => [
  [0, 0],
  [radius * 0.55, 0],
  [radius * 0.9, height * 0.15],
  [radius, height * 0.35],
  [radius * 0.92, height * 0.6],
  [radius * 0.68, height * 0.82],
  [radius * 0.35, height * 0.96],
  [0, height],
];

/** A round or square pot with a plant growing out of it. */
export default definePiece({
  id: 'garden.planter',
  parts: (values) => {
    const { width: w, height: h } = sizeOf(values);
    const plant = numberParam(values, 'plantHeight');
    const pot = colorParam(values, 'color');
    const leaves = colorParam(values, 'plantColor');
    const soil = shade(pot, -0.45);
    if (String(values.shape) === 'square') {
      const parts = [
        box([0, h / 2, 0], [w, h, w], pot, 'body'),
        box([0, h - 0.01, 0], [w - 0.04, 0.02, w - 0.04], soil, 'detail'),
      ];
      if (plant > 0) {
        parts.push(
          cylinder([0, h + plant * 0.35, 0], w * 0.8, plant * 0.7, leaves, 'body'),
          cylinder([0, h + plant * 0.85, 0], w * 0.55, plant * 0.3, shade(leaves, 0.15), 'detail'),
        );
      }
      return parts;
    }
    const top = h - SOIL_DROP;
    const parts = [
      lathe([0, 0, 0], potProfile(w / 2, h), pot, 'body'),
      cylinder([0, top + 0.005, 0], w - 2 * WALL, 0.01, soil, 'detail'),
    ];
    // The plant stands in the soil and ends `plant` above the rim, as its dimension line says.
    if (plant > 0) {
      parts.push(lathe([0, top, 0], bushProfile(w * 0.4, plant + SOIL_DROP), leaves, 'body'));
    }
    return parts;
  },
  dimensions: (values) => {
    const { width: w, height: h } = sizeOf(values);
    const plant = numberParam(values, 'plantHeight');
    return [
      dimension([-w / 2, 0, w / 2], [w / 2, 0, w / 2], w, 'Diameter'),
      dimension([w / 2, 0, 0], [w / 2, h, 0], h, 'Pot height'),
      dimension([w / 2, h, 0], [w / 2, h + plant, 0], plant, 'Plant height'),
    ];
  },
});
