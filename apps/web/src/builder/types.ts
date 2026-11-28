import type { Vec2, Vec3 } from '../geom/types';

/**
 * A polygon in a local (x, y) plane, extruded through `depth` along local z (centred on the
 * plane), rotated about y by `rotationY` and moved to `center`. See `solidPoint`.
 */
export interface ProfileSolid {
  center: Vec3;
  rotationY: number;
  depth: number;
  outline: Vec2[];
}

/**
 * How a texture is laid on a surface (docs/design/realistic-render.md §5.4): a point of the world
 * and two unit directions. A vertex's texture coordinate, in metres, is its distance from `origin`
 * along `u` and along `v`.
 */
export interface UvFrame {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
}

/** A gable roof resolved against the footprint; "across" is the plan axis across the ridge. */
export interface Gable {
  levelId: string;
  ridgeAxis: 'x' | 'z';
  /** Footprint bounds along the ridge and across it. */
  along: Vec2;
  across: Vec2;
  /** Across coordinate of the ridge. */
  ridge: number;
  /** Height of the roof underside at the footprint edge, and its slope (rise per metre). */
  eaveY: number;
  slope: number;
  thickness: number;
  overhang: number;
}
