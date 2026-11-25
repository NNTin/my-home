import { formatCm, type ParamValues } from '@my-home/shared';
import type { Vec2, Vec3 } from '../builder/buildHome';
import type { DimensionLine, Part, PartMaterial, PartRole } from './types';

/** Building blocks for piece modules. */

export const box = (
  center: Vec3,
  size: Vec3,
  color: string,
  role: PartRole,
  material?: PartMaterial,
): Part => ({
  shape: 'box',
  center,
  size,
  rotationY: 0,
  color,
  role,
  ...(material && { material }),
});

/** An upright cylinder of `diameter` (or an elliptic one, `depth` across z). */
export const cylinder = (
  center: Vec3,
  diameter: number,
  height: number,
  color: string,
  role: PartRole,
  depth = diameter,
): Part => ({
  shape: 'cylinder',
  center,
  size: [diameter, height, depth],
  rotationY: 0,
  color,
  role,
});

/** A box whose edges and corners are rounded by `radius`: at most half its smallest side. */
export const roundedBox = (
  center: Vec3,
  size: Vec3,
  radius: number,
  color: string,
  role: PartRole,
  material?: PartMaterial,
): Part => ({
  ...box(center, size, color, role, material),
  shape: 'roundedBox',
  radius: Math.max(0, Math.min(radius, ...size.map((s) => s / 2))),
});

const span = (values: number[]) => {
  const [min, max] = [Math.min(...values), Math.max(...values)];
  return { middle: (min + max) / 2, size: max - min };
};

/**
 * A closed `outline` in x/y about `origin`, extruded through `depth` along z (half to each side
 * of the origin), then turned about the origin's y axis by `rotationY`: -π/2 lays the outline's x
 * along the piece's z (a moulding or a worktop edge that runs along x). The outline may wind
 * either way.
 */
export function extrude(
  origin: Vec3,
  outline: Vec2[],
  depth: number,
  color: string,
  role: PartRole,
  rotationY = 0,
  material?: PartMaterial,
): Part {
  const x = span(outline.map((p) => p[0]));
  const y = span(outline.map((p) => p[1]));
  return {
    shape: 'extrude',
    // The middle of the outline's box, turned with it.
    center: [
      origin[0] + x.middle * Math.cos(rotationY),
      origin[1] + y.middle,
      origin[2] - x.middle * Math.sin(rotationY),
    ],
    size: [x.size, y.size, depth],
    profile: outline.map(([px, py]) => [px - x.middle, py - y.middle]),
    rotationY,
    color,
    role,
    ...(material && { material }),
  };
}

/**
 * A `profile` of [radius, y] points about `origin`, turned about the origin's y axis: a pot, a
 * lamp shade, a turned leg. Give it from the bottom up along the outside (and back down the
 * inside for a hollow one), and a point twice for a sharp edge; see `PartShape`.
 */
export function lathe(
  origin: Vec3,
  profile: Vec2[],
  color: string,
  role: PartRole,
  material?: PartMaterial,
): Part {
  const radii = profile.map((p) => Math.max(0, p[0]));
  const y = span(profile.map((p) => p[1]));
  const diameter = 2 * Math.max(...radii);
  return {
    shape: 'lathe',
    center: [origin[0], origin[1] + y.middle, origin[2]],
    size: [diameter, y.size, diameter],
    profile: profile.map(([, py], i) => [radii[i]!, py - y.middle]),
    rotationY: 0,
    color,
    role,
    ...(material && { material }),
  };
}

/** The part tilted about its own x axis by `angle` radians (see `Part.rotationX`). */
export const tilted = (part: Part, angle: number): Part => ({ ...part, rotationX: angle });

/** A numeric parameter; effective values always carry every key of their type. */
export function numberParam(values: ParamValues, key: string): number {
  const value = values[key];
  if (typeof value !== 'number') throw new Error(`Parameter "${key}" is not a number`);
  return value;
}

export function colorParam(values: ParamValues, key: string): string {
  const value = values[key];
  if (typeof value !== 'string') throw new Error(`Parameter "${key}" is not a colour`);
  return value;
}

export const dimension = (from: Vec3, to: Vec3, value: number, name?: string): DimensionLine => ({
  from,
  to,
  value,
  label: formatCm(value),
  ...(name && { name }),
});

/** Mixes a `#rrggbb` colour towards black (`amount` < 0) or white (`amount` > 0). */
export function shade(color: string, amount: number) {
  const n = Number.parseInt(color.slice(1), 16);
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  const channel = (shift: number) => {
    const c = (n >> shift) & 0xff;
    return Math.round(c + (target - c) * t);
  };
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, '0')}`;
}
