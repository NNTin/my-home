import type { Vec2 } from '../../builder/buildHome';

/**
 * A plant as one rounded mass, for `lathe`: widest a third of the way up, closing to a blunt top.
 * `foot` is the share of the radius it has where it leaves the ground.
 */
export const bushProfile = (radius: number, height: number, foot = 0.55): Vec2[] => [
  [0, 0],
  [radius * foot, 0],
  [radius * 0.9, height * 0.15],
  [radius, height * 0.35],
  [radius * 0.92, height * 0.6],
  [radius * 0.68, height * 0.82],
  [radius * 0.35, height * 0.96],
  [0, height],
];
